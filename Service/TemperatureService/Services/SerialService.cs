using System;
using System.IO.Ports;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TemperatureService.Data;
using TemperatureService.Models;
using TemperatureService.Hubs;

namespace TemperatureService.Services
{
    public class SerialService
    {
        private readonly IHubContext<TelemetryHub> _hubContext;
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<SerialService> _logger;

        private SerialPort _serialPort;
        private Thread _readThread;
        private CancellationTokenSource _simCts;
        private readonly object _lock = new object();

        // Estado actual de conexión
        private bool _isConnected = false;
        private string _activePortName = "";
        private int _activeBaudRate = 115200;

        // Historial de la última calibración/medición en caché
        private double? _lastTemperature = null;
        private double? _lastLightLevel = null;
        private DateTime _lastDbSaveTime = DateTime.MinValue;

        public SerialService(
            IHubContext<TelemetryHub> hubContext,
            IServiceProvider serviceProvider,
            ILogger<SerialService> logger)
        {
            _hubContext = hubContext;
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        // Obtiene puertos disponibles
        public string[] GetAvailablePorts()
        {
            var ports = SerialPort.GetPortNames();
            var list = new System.Collections.Generic.List<string>(ports);
            if (!list.Contains("SIMULATOR"))
            {
                list.Add("SIMULATOR");
            }
            return list.ToArray();
        }

        public (bool IsConnected, string PortName, int BaudRate) GetStatus()
        {
            lock (_lock)
            {
                return (_isConnected, _activePortName, _activeBaudRate);
            }
        }

        // Conectar a un puerto
        public void Connect(string portName, int baudRate)
        {
            lock (_lock)
            {
                if (_isConnected)
                {
                    throw new InvalidOperationException("Ya existe una conexión activa.");
                }

                _activePortName = portName;
                _activeBaudRate = baudRate;

                // Resetear mediciones
                _lastTemperature = null;
                _lastLightLevel = null;
                _lastDbSaveTime = DateTime.MinValue;

                if (portName == "SIMULATOR")
                {
                    _isConnected = true;
                    _simCts = new CancellationTokenSource();
                    Task.Run(() => SimulationLoop(_simCts.Token));
                    _hubContext.Clients.All.SendAsync("ReceiveStatus", new
                    {
                        isConnected = true,
                        portName = "SIMULATOR",
                        baudRate = baudRate
                    });
                    _hubContext.Clients.All.SendAsync("ReceiveTxLog", "[Sistema] Conectado al simulador de sensores (OPT3001 y TMP117).");
                }
                else
                {
                    try
                    {
                        _serialPort = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One);
                        _serialPort.ReadTimeout = 500;
                        _serialPort.WriteTimeout = 500;
                        _serialPort.Open();

                        _isConnected = true;

                        _readThread = new Thread(ReadLoop);
                        _readThread.IsBackground = true;
                        _readThread.Start();

                        _hubContext.Clients.All.SendAsync("ReceiveStatus", new
                        {
                            isConnected = true,
                            portName = portName,
                            baudRate = baudRate
                        });
                        _hubContext.Clients.All.SendAsync("ReceiveTxLog", $"[Sistema] Conectado al puerto {portName} a {baudRate} bps.");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"Error al conectar al puerto {portName}: {ex.Message}");
                        _isConnected = false;
                        _activePortName = "";
                        throw;
                    }
                }
            }
        }

        // Desconectar
        public void Disconnect()
        {
            lock (_lock)
            {
                if (!_isConnected) return;

                _isConnected = false;

                if (_activePortName == "SIMULATOR")
                {
                    _simCts?.Cancel();
                    _simCts?.Dispose();
                    _simCts = null;
                }
                else
                {
                    try
                    {
                        if (_serialPort != null)
                        {
                            if (_serialPort.IsOpen)
                            {
                                _serialPort.Close();
                            }
                            _serialPort.Dispose();
                            _serialPort = null;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"Error al cerrar el puerto: {ex.Message}");
                    }

                    if (_readThread != null && _readThread.IsAlive)
                    {
                        _readThread.Join(1000);
                        _readThread = null;
                    }
                }

                string prevPort = _activePortName;
                _activePortName = "";

                _hubContext.Clients.All.SendAsync("ReceiveStatus", new
                {
                    isConnected = false,
                    portName = "",
                    baudRate = _activeBaudRate
                });
                _hubContext.Clients.All.SendAsync("ReceiveTxLog", $"[Sistema] Desconectado del puerto {prevPort}.");
            }
        }

        // Bucle de lectura serial físico
        private void ReadLoop()
        {
            while (true)
            {
                lock (_lock)
                {
                    if (!_isConnected || _serialPort == null || !_serialPort.IsOpen)
                    {
                        break;
                    }
                }

                try
                {
                    string line = _serialPort.ReadLine();
                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        string trimmed = line.Trim();
                        // Enviar log a consola crudo
                        _hubContext.Clients.All.SendAsync("ReceiveData", trimmed);

                        // Parsear datos
                        ProcessLine(trimmed);
                    }
                }
                catch (TimeoutException)
                {
                    // Ignorar timeouts normales de lectura
                }
                catch (Exception ex)
                {
                    _logger.LogError($"Error en lectura de puerto serie: {ex.Message}");
                    lock (_lock)
                    {
                        if (_serialPort == null || !_serialPort.IsOpen)
                        {
                            HandleUnexpectedDisconnection();
                            break;
                        }
                    }
                    Thread.Sleep(500);
                }
            }
        }

        // Bucle de simulación
        private async Task SimulationLoop(CancellationToken token)
        {
            double phase = 0.0;
            Random random = new Random();

            while (!token.IsCancellationRequested)
            {
                try
                {
                    phase += 0.05;
                    // Simular temperatura entre -20°C y +50°C con ruido
                    double simTemp = 5 + -35 * Math.Sin(phase) + (random.NextDouble() - 0.5) * 0.1;
                    // Simular iluminación entre 100 y 600 Lux con ruido
                    double simLight = 350.0 + 200.0 * Math.Cos(phase) + (random.NextDouble() - 0.5) * 5.0;

                    // El simulador transmite las dos líneas de forma separada como lo haría el microcontrolador
                    if (random.Next(2) == 0)
                    {
                        string luxLine = $"Lux = {simLight:F2}";
                        await _hubContext.Clients.All.SendAsync("ReceiveData", luxLine, cancellationToken: token);
                        ProcessLine(luxLine);
                    }
                    else
                    {
                        string tempLine = $"Temperature = {simTemp:F2}";
                        await _hubContext.Clients.All.SendAsync("ReceiveData", tempLine, cancellationToken: token);
                        ProcessLine(tempLine);
                    }

                    await Task.Delay(500, token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError($"Error en bucle de simulación: {ex.Message}");
                }
            }
        }

        // Procesar línea y extraer valores numéricos
        private void ProcessLine(string line)
        {
            bool updated = false;

            // Parser para Lux
            var matchLux = Regex.Match(line, @"(?:Lux|Light|L)\s*[:=]\s*(-?[0-9.]+)", RegexOptions.IgnoreCase);
            if (matchLux.Success && double.TryParse(matchLux.Groups[1].Value, CultureInfo.InvariantCulture, out double parsedLux))
            {
                // Rango del OPT3001: 0.01 a 83000 lux
                if (parsedLux >= 0.01 && parsedLux <= 83000)
                {
                    _lastLightLevel = Math.Round(parsedLux, 2);
                    updated = true;
                }
            }
            else if (line.Contains("Lux = null", StringComparison.OrdinalIgnoreCase) || line.Contains("L:null", StringComparison.OrdinalIgnoreCase))
            {
                _lastLightLevel = null;
                updated = true;
            }

            // Parser para Temperatura
            var matchTemp = Regex.Match(line, @"(?:Temperature|Temp|T)\s*[:=]\s*(-?[0-9.]+)", RegexOptions.IgnoreCase);
            if (matchTemp.Success && double.TryParse(matchTemp.Groups[1].Value, CultureInfo.InvariantCulture, out double parsedTemp))
            {
                // Rango del TMP117: -20°C a +50°C
                if (parsedTemp >= -30.0 && parsedTemp <= 50.0)
                {
                    _lastTemperature = Math.Round(parsedTemp, 2);
                    updated = true;
                }
            }
            else if (line.Contains("Temperature = null", StringComparison.OrdinalIgnoreCase) || line.Contains("T:null", StringComparison.OrdinalIgnoreCase))
            {
                _lastTemperature = null;
                updated = true;
            }

            if (updated)
            {
                // Emitir telemetría actual a los clientes en tiempo real
                _hubContext.Clients.All.SendAsync("ReceiveTelemetry", new
                {
                    temperature = _lastTemperature,
                    lightLevel = _lastLightLevel
                });

                // Lógica de persistencia en base de datos con aceleración/throttle de 5 segundos
                if (DateTime.UtcNow - _lastDbSaveTime >= TimeSpan.FromSeconds(5))
                {
                    _lastDbSaveTime = DateTime.UtcNow;
                    SaveToDatabase(_lastTemperature, _lastLightLevel);
                }
            }
        }

        // Guardado periódico en la base de datos SQL Server
        private void SaveToDatabase(double? temperature, double? lightLevel)
        {
            try
            {
                using (var scope = _serviceProvider.CreateScope())
                {
                    var context = scope.ServiceProvider.GetRequiredService<TelemetryDbContext>();
                    var record = new TelemetryRecord
                    {
                        Timestamp = DateTime.Now,
                        Temperature = temperature,
                        LightLevel = lightLevel
                    };

                    context.TelemetryRecords.Add(record);
                    context.SaveChanges();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error al guardar telemetría en SQL Server: {ex.Message}");
                _hubContext.Clients.All.SendAsync("ReceiveTxLog", $"[Error] No se pudo guardar en la base de datos: {ex.Message}");
            }
        }

        private void HandleUnexpectedDisconnection()
        {
            _isConnected = false;
            _activePortName = "";
            _hubContext.Clients.All.SendAsync("ReceiveStatus", new
            {
                isConnected = false,
                portName = "",
                baudRate = _activeBaudRate
            });
            _hubContext.Clients.All.SendAsync("ReceiveTxLog", "⚠️ [Sistema] Conexión perdida inesperadamente con el puerto.");
        }
    }
}
