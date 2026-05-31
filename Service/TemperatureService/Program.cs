using Microsoft.EntityFrameworkCore;
using TemperatureService.Data;
using TemperatureService.Services;
using TemperatureService.Hubs;

var builder = WebApplication.CreateBuilder(args);

// 1. Configurar base de datos SQL Server
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<TelemetryDbContext>(options =>
    options.UseSqlServer(connectionString));

// 2. Configurar CORS para la app Angular (local en puerto 4200)
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsPolicy", policy =>
    {
        policy.WithOrigins("http://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// 3. Registrar servicios y SignalR
builder.Services.AddSingleton<SerialService>();
builder.Services.AddSignalR();
builder.Services.AddControllers();

var app = builder.Build();

// 4. Crear Base de Datos al iniciar
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<TelemetryDbContext>();
    // EnsureCreated creará automáticamente la BD 'TemperatureMonitorDb' y la tabla 'TelemetryRecords'
    // si no existen aún en la instancia de SQL Server.
    context.Database.EnsureCreated();
}

app.UseCors("CorsPolicy");

app.UseAuthorization();

app.MapControllers();

// Mapear canal en tiempo real de SignalR
app.MapHub<TelemetryHub>("/hubs/telemetry");

app.Run();
