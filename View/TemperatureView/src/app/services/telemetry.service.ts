import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import * as signalR from '@microsoft/signalr';

export interface TerminalLine {
  text: string;
  timestamp: string;
  type: 'system' | 'tx' | 'rx' | 'error';
}

export interface TelemetryData {
  temperature: number | null;
  lightLevel: number | null;
}

export interface TelemetryRecord {
  id: number;
  timestamp: string;
  temperature: number | null;
  lightLevel: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class TelemetryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:5200/api/telemetry';
  private hubConnection: signalR.HubConnection | null = null;

  // --- ANGULAR SIGNALS ---
  public readonly isConnected = signal<boolean>(false);
  public readonly activePort = signal<string>('');
  public readonly activeBaudRate = signal<number>(115200);

  // Telemetría en tiempo real
  public readonly telemetry = signal<TelemetryData>({ temperature: null, lightLevel: null });

  // Historial de logs
  public readonly terminalLines = signal<TerminalLine[]>([]);

  constructor() {
    this.checkInitialStatus();
    this.startSignalRConnection();
  }

  // 1. PETICIONES HTTP (REST)
  
  public getAvailablePorts(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/ports`);
  }

  public connect(portName: string, baudRate: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/connect`, { portName, baudRate });
  }

  public disconnect(): Observable<any> {
    return this.http.post(`${this.baseUrl}/disconnect`, {});
  }

  public getHistory(): Observable<TelemetryRecord[]> {
    return this.http.get<TelemetryRecord[]>(`${this.baseUrl}/history`);
  }

  public clearTerminal() {
    this.terminalLines.set([]);
  }

  // 2. CONEXIÓN POR WEBSOCKETS (SignalR)

  private startSignalRConnection() {
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl('http://localhost:5200/hubs/telemetry')
      .withAutomaticReconnect()
      .build();

    this.hubConnection
      .start()
      .then(() => {
        this.logToTerminal(
          '[Sistema] Conectado al canal de comunicación en tiempo real (SignalR).',
          'system',
        );
        this.registerSignalREvents();
      })
      .catch((err) => {
        this.logToTerminal(
          `[Sistema] Error al conectar con SignalR: ${err}`,
          'error',
        );
      });
  }

  private registerSignalREvents() {
    if (!this.hubConnection) return;

    // Escucha logs crudos del puerto UART
    this.hubConnection.on('ReceiveData', (data: string) => {
      this.logToTerminal(data, 'rx');
    });

    // Escucha logs de envío y de sistema
    this.hubConnection.on('ReceiveTxLog', (log: string) => {
      if (log.startsWith('[Error]')) {
        this.logToTerminal(log, 'error');
      } else {
        this.logToTerminal(log, 'system');
      }
    });

    // Escucha cambios en el estado de conexión
    this.hubConnection.on(
      'ReceiveStatus',
      (status: {
        isConnected: boolean;
        portName: string | null;
        baudRate: number;
      }) => {
        this.isConnected.set(status.isConnected);
        this.activePort.set(status.portName || '');
        this.activeBaudRate.set(status.baudRate);
      },
    );

    // Escucha telemetría numérica parseada
    this.hubConnection.on('ReceiveTelemetry', (telemetry: TelemetryData) => {
      this.telemetry.set(telemetry);
    });
  }

  private checkInitialStatus() {
    this.http.get<any>(`${this.baseUrl}/status`).subscribe({
      next: (status) => {
        this.isConnected.set(status.isConnected);
        this.activePort.set(status.portName || '');
        this.activeBaudRate.set(status.baudRate);
      },
      error: () => {
        this.logToTerminal(
          '[Sistema] No se pudo obtener el estado inicial del servidor.',
          'error',
        );
      },
    });
  }

  public logToTerminal(text: string, type: 'system' | 'tx' | 'rx' | 'error') {
    const timestamp = new Date().toLocaleTimeString();
    this.terminalLines.update((lines) => {
      const currentLines = lines.length > 200 ? lines.slice(lines.length - 200) : lines;
      return [...currentLines, { text, timestamp, type }];
    });
  }
}
