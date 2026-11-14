"""A course definition: where it is, which NOAA model covers it, and which 36 hours are replayed.

Definitions live in pipeline/courses/<id>.json. Every pipeline script takes the id (or a path to a definition) first.
"""
import datetime as dt
import json
import math
import os

EARTH = 6371008.8
M_PER_DEG_LAT = EARTH * math.pi / 180.0
HERE = os.path.dirname(os.path.abspath(__file__))


def _time(text: str) -> dt.datetime:
    return dt.datetime.strptime(text, "%Y-%m-%dT%H:%M")


class Course:
    def __init__(self, spec: dict):
        self.spec = spec
        self.id = spec["id"]
        self.name = spec["name"]
        self.origin = spec["origin"]
        self.m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(self.origin["lat"]))
        season = spec["season"]
        # The first hour of the season, UTC. It must be a cycle time of the tide model (03z, 09z, 15z or 21z).
        self.first_cycle = _time(season["start"])
        self.truth_hours = season["hours"]
        self.forecast_hours = season["forecastHours"]
        self.hrrr_forecast_cycle = _time(season["hrrrForecastCycle"])
        self.model = spec["model"]

    def to_xy(self, lat, lon):
        import numpy as np
        return (np.asarray(lon) - self.origin["lon"]) * self.m_per_deg_lon, (np.asarray(lat) - self.origin["lat"]) * M_PER_DEG_LAT

    def to_latlon(self, x, y):
        import numpy as np
        return self.origin["lat"] + np.asarray(y) / M_PER_DEG_LAT, self.origin["lon"] + np.asarray(x) / self.m_per_deg_lon


def load(name: str) -> Course:
    """By id ("sf-bay") or by path to a definition file."""
    path = name if os.path.exists(name) else os.path.join(HERE, "courses", f"{name}.json")
    with open(path) as f:
        return Course(json.load(f))
