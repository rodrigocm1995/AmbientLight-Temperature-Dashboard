using Microsoft.AspNetCore.Mvc;
using System;
using System.Linq;
using TemperatureService.Data;
using TemperatureService.Services;

namespace TemperatureService.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TelemetryController : ControllerBase
    {
        private readonly SerialService _serialService;
        private readonly TelemetryDbContext _dbContext;

        public TelemetryController(SerialService serialService, TelemetryDbContext dbContext)
        {
            _serialService = serialService;
            _dbContext = dbContext;
        }

        [HttpGet("ports")]
        public IActionResult GetPorts()
        {
            try
            {
                return Ok(_serialService.GetAvailablePorts());
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            try
            {
                var status = _serialService.GetStatus();
                return Ok(new
                {
                    isConnected = status.IsConnected,
                    portName = status.PortName,
                    baudRate = status.BaudRate
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpPost("connect")]
        public IActionResult Connect([FromBody] ConnectRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.PortName))
            {
                return BadRequest(new { message = "Puerto inválido." });
            }

            try
            {
                _serialService.Connect(request.PortName, request.BaudRate);
                return Ok(new { message = $"Conectado exitosamente a {request.PortName}." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpPost("disconnect")]
        public IActionResult Disconnect()
        {
            try
            {
                _serialService.Disconnect();
                return Ok(new { message = "Desconectado exitosamente." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpGet("history")]
        public IActionResult GetHistory()
        {
            try
            {
                var history = _dbContext.TelemetryRecords
                    .OrderByDescending(r => r.Timestamp)
                    .Take(100)
                    .ToList();
                return Ok(history);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }
    }

    public class ConnectRequest
    {
        public string PortName { get; set; }
        public int BaudRate { get; set; }
    }
}
