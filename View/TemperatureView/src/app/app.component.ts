// (Wait, this is C# code comment, let's write typescript!)
import {
  Component,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  signal,
  effect,
  inject,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TelemetryService, TelemetryRecord } from './services/telemetry.service';
import { Chart, registerables } from 'chart.js';

// Angular Material Imports
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTableModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, AfterViewInit {
  public readonly telemetryService = inject(TelemetryService);
  private readonly snackBar = inject(MatSnackBar);

  // --- CANVASES DE LAS GRÁFICAS ---
  @ViewChild('tempChartCanvas') tempChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('lightChartCanvas') lightChartCanvas!: ElementRef<HTMLCanvasElement>;

  // --- REFERENCIA DE LA CONSOLA ---
  @ViewChild('terminalConsole') terminalConsole!: ElementRef<HTMLDivElement>;

  // --- ESTADO DE INTERFAZ ---
  public readonly availablePorts = signal<string[]>([]);
  public readonly selectedPort = signal<string>('');
  public readonly selectedBaudRate = signal<number>(115200);
  public readonly isDarkMode = signal<boolean>(true);

  // Historial de base de datos
  public readonly historyRecords = signal<TelemetryRecord[]>([]);
  public readonly displayedColumns: string[] = ['timestamp', 'temperature', 'lightLevel'];

  // Baudios estándar
  public readonly baudRates = [9600, 19200, 38400, 57600, 115200];

  // Instancias de Chart.js
  private tempChart!: Chart;
  private lightChart!: Chart;

  // Reactividad para las métricas numéricas
  public readonly currentTemperature = computed(() => {
    const t = this.telemetryService.telemetry().temperature;
    return t !== null ? t.toFixed(2) + ' °C' : '-- °C';
  });

  public readonly currentLightLevel = computed(() => {
    const l = this.telemetryService.telemetry().lightLevel;
    return l !== null ? l.toFixed(2) + ' Lux' : '-- Lux';
  });

  constructor() {
    // Actualizar gráficas cuando cambia la telemetría
    effect(() => {
      const data = this.telemetryService.telemetry();
      this.updateCharts(data);
    });

    // Auto-scroll de la consola de logs
    effect(() => {
      const lines = this.telemetryService.terminalLines();
      if (lines.length > 0) {
        setTimeout(() => this.scrollToBottom(), 50);
      }
    });

    // Recargar historial al conectar y periódicamente si estamos conectados
    effect(() => {
      const isConnected = this.telemetryService.isConnected();
      if (isConnected) {
        this.loadHistory();
      } else {
        this.historyRecords.set([]);
      }
    });
  }

  ngOnInit() {
    this.loadPorts();
    
    // Configurar temporizador para recargar el historial de la base de datos cada 5 segundos
    setInterval(() => {
      if (this.telemetryService.isConnected()) {
        this.loadHistory();
      }
    }, 5000);
  }

  ngAfterViewInit() {
    this.initializeCharts();
  }

  // Carga los puertos desde el backend
  public loadPorts() {
    this.telemetryService.getAvailablePorts().subscribe({
      next: (ports) => {
        this.availablePorts.set(ports);
        if (ports.length > 0 && !this.selectedPort()) {
          const defaultPort = ports.includes('SIMULATOR') ? 'SIMULATOR' : ports[0];
          this.selectedPort.set(defaultPort);
        }
      },
      error: () => {
        this.snackBar.open('Error al obtener puertos del backend', 'Cerrar', { duration: 3000 });
      },
    });
  }

  // Conectar serial / simulator
  public onConnect() {
    const port = this.selectedPort();
    const baud = this.selectedBaudRate();
    if (!port) return;

    this.telemetryService.connect(port, baud).subscribe({
      next: () => {
        this.clearChartData();
        this.loadHistory();
        this.snackBar.open(`Conectado a ${port}`, 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        const errorMsg = err.error?.message || err.message || 'Error desconocido';
        this.snackBar.open(`Error de conexión: ${errorMsg}`, 'Cerrar', { duration: 4000 });
      },
    });
  }

  // Desconectar
  public onDisconnect() {
    this.telemetryService.disconnect().subscribe({
      next: () => {
        this.snackBar.open('Desconectado exitosamente', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(`Error al desconectar: ${err.message}`, 'Cerrar', { duration: 3000 });
      },
    });
  }

  // Carga el historial de SQL Server
  public loadHistory() {
    this.telemetryService.getHistory().subscribe({
      next: (records) => {
        this.historyRecords.set(records);
      },
      error: () => {
        console.error("Error al cargar historial"); // Just logged locally
      }
    });
  }

  // Limpiar terminal
  public onClearConsole() {
    this.telemetryService.clearTerminal();
  }

  // Alterna entre tema claro y oscuro
  public onToggleTheme() {
    this.isDarkMode.update((v) => !v);
    const body = document.body;
    if (this.isDarkMode()) {
      body.classList.remove('light-theme');
    } else {
      body.classList.add('light-theme');
    }
    this.updateChartTheme();
  }

  // Inicializa las gráficas de Chart.js
  private initializeCharts() {
    const chartConfig = (
      canvas: HTMLCanvasElement,
      label: string,
      lineColor: string,
      fillColor: string
    ) => {
      const ctx = canvas.getContext('2d');
      let gradient: CanvasGradient | undefined;

      if (ctx) {
        gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, fillColor);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }

      return new Chart(canvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: label,
              data: [],
              borderColor: lineColor,
              backgroundColor: gradient || lineColor,
              fill: true,
              borderWidth: 2,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
            },
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: {
                color: '#9ca3af',
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 5,
                font: { family: 'Outfit', size: 10 },
              },
            },
            y: {
              suggestedMin: undefined,
              suggestedMax: undefined,
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: {
                color: '#9ca3af',
                font: { family: 'Outfit', size: 10 },
              },
            },
          },
        },
      });
    };

    // Gráfica de Temperatura (°C) - Color naranja/rojo
    this.tempChart = chartConfig(
      this.tempChartCanvas.nativeElement,
      'Temperatura (°C)',
      '#ff6b6b',
      'rgba(255, 107, 107, 0.15)'
    );

    // Gráfica de Iluminación (Lux) - Color amarillo
    this.lightChart = chartConfig(
      this.lightChartCanvas.nativeElement,
      'Iluminación (Lux)',
      '#ffd23f',
      'rgba(255, 210, 63, 0.15)'
    );

    this.updateChartTheme();
  }

  // Agrega datos en tiempo real a las gráficas y autoajusta ejes Y
  private updateCharts(data: any) {
    if (!this.tempChart || !this.lightChart) return;
    if (!this.telemetryService.isConnected()) return;

    const timeLabel = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const pushData = (
      chart: Chart,
      value: number | null | undefined,
      minSpan: number,
      allowNegative: boolean = false
    ) => {
      // Ignorar valores nulos para la gráfica (mantiene la línea continua con los últimos válidos)
      if (value === null || value === undefined) return;

      chart.data.labels?.push(timeLabel);
      chart.data.datasets[0].data.push(value);

      if (chart.data.datasets[0].data.length > 45) {
        chart.data.datasets[0].data.shift();
        chart.data.labels?.shift();
      }

      // Escalado adaptativo para evitar oscilaciones por ruido de micro-escala
      const dataPoints = chart.data.datasets[0].data as number[];
      if (dataPoints.length > 0) {
        let yMin = dataPoints[0];
        let yMax = dataPoints[0];
        for (let j = 1; j < dataPoints.length; j++) {
          if (dataPoints[j] < yMin) yMin = dataPoints[j];
          if (dataPoints[j] > yMax) yMax = dataPoints[j];
        }

        const diff = yMax - yMin;
        if (diff < minSpan) {
          // Centrar el span mínimo sugerido alrededor de la media
          const mid = (yMax + yMin) / 2;
          let calculatedMin = mid - minSpan / 2;
          if (!allowNegative && calculatedMin < 0) {
            calculatedMin = 0;
          }
          let calculatedMax = calculatedMin + minSpan;

          if (chart.options.scales?.['y']) {
            chart.options.scales['y'].suggestedMin = calculatedMin;
            chart.options.scales['y'].suggestedMax = calculatedMax;
          }
        } else {
          // Si la fluctuación es amplia, dejamos que auto-escala funcione libremente
          if (chart.options.scales?.['y']) {
            chart.options.scales['y'].suggestedMin = allowNegative ? undefined : 0;
            chart.options.scales['y'].suggestedMax = undefined;
          }
        }
      }

      chart.update('none');
    };

    pushData(this.tempChart, data.temperature, 2.0, true);   // TMP117: minSpan de 2°C, permite bajo cero (-20°C)
    pushData(this.lightChart, data.lightLevel, 50.0, false); // OPT3001: minSpan de 50 Lux, no permite bajo cero
  }

  // Limpiar gráficas
  private clearChartData() {
    const resetChart = (chart: Chart) => {
      if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update('none');
      }
    };
    resetChart(this.tempChart);
    resetChart(this.lightChart);
  }

  // Ajusta tema de Chart.js
  private updateChartTheme() {
    const isDark = this.isDarkMode();
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#9ca3af' : '#4b5563';

    const applyTheme = (chart: Chart) => {
      if (!chart) return;
      if (chart.options.scales?.['x']) {
        chart.options.scales['x'].grid = { color: gridColor };
        if (chart.options.scales['x'].ticks) {
          chart.options.scales['x'].ticks.color = textColor;
        }
      }
      if (chart.options.scales?.['y']) {
        chart.options.scales['y'].grid = { color: gridColor };
        if (chart.options.scales['y'].ticks) {
          chart.options.scales['y'].ticks.color = textColor;
        }
      }
      chart.update('none');
    };

    applyTheme(this.tempChart);
    applyTheme(this.lightChart);
  }

  private scrollToBottom() {
    if (this.terminalConsole) {
      const el = this.terminalConsole.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}
