"""System-monitor module kept independent from FastAPI transport."""

import socket
from typing import Any

import psutil

def collect_metrics() -> dict[str, Any]:
    """Collect low-risk machine telemetry for display in the local HUD."""
    temperatures = psutil.sensors_temperatures() if hasattr(psutil, "sensors_temperatures") else {}
    reading = next((item.current for values in temperatures.values() for item in values if item.current), 0)
    try:
        ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        ip = "127.0.0.1"
    return {"cpu": round(psutil.cpu_percent()), "ram": round(psutil.virtual_memory().percent),
            "gpu": 0, "disk": round(psutil.disk_usage('/').percent), "temperature": round(reading),
            "volume": 68, "fps": 60, "ip": ip, "network": "ENCRYPTED LINK", "internet": 1.2}
