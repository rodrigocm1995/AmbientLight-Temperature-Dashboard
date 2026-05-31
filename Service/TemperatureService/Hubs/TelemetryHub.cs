using Microsoft.AspNetCore.SignalR;

namespace TemperatureService.Hubs
{
    public class TelemetryHub : Hub
    {
        // El hub sirve como retransmisor de eventos del puerto serial a todos los clientes Angular conectados.
    }
}
