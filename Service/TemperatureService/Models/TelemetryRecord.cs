using System;

namespace TemperatureService.Models
{
    public class TelemetryRecord
    {
        public int Id { get; set; }
        public DateTime Timestamp { get; set; }
        public double? Temperature { get; set; }
        public double? LightLevel { get; set; }
    }
}
