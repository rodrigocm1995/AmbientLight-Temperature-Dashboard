using Microsoft.EntityFrameworkCore;
using TemperatureService.Models;

namespace TemperatureService.Data
{
    public class TelemetryDbContext : DbContext
    {
        public TelemetryDbContext(DbContextOptions<TelemetryDbContext> options) : base(options)
        {
        }

        public DbSet<TelemetryRecord> TelemetryRecords { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configurar tabla
            modelBuilder.Entity<TelemetryRecord>(entity =>
            {
                entity.ToTable("TelemetryRecords");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Timestamp).IsRequired();
                entity.Property(e => e.Temperature).IsRequired(false);
                entity.Property(e => e.LightLevel).IsRequired(false);
            });
        }
    }
}
