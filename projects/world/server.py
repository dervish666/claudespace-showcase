#!/usr/bin/env python3
"""World Command Centre — real-time global stats dashboard.

Session 1: scaffold + Seismic tab (USGS earthquake feed).
Session 2: Orbital tab (ISS tracker, orbit ground track, terminator, people in space).
Session 3: Solar tab (NOAA SWPC — Kp, solar wind, X-ray, aurora ovation, alerts).
Session 4: Atmosphere tab (Open-Meteo — world city weather, temperature heat map).
Session 5: Population tab (World Bank rates — live ticking counters, top countries).
Future sessions will add tabs for volcanoes, network, etc.
"""
import json
import math
import os
import threading
import time
import urllib.request
from collections import deque
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import requests as req_lib  # for SSE streaming
from sgp4.api import Satrec, jday

PORT = 8122
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Simple in-memory cache: key -> (expires_at, data)
_CACHE: dict = {}

def cached_fetch(key: str, url: str, ttl: float, timeout: float = 10.0, stale_ok: bool = False):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and hit[0] > now:
        return hit[1]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "world-dashboard/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except Exception:
        if stale_ok and hit:
            return hit[1]
        raise
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"_raw": raw.decode("utf-8", "replace")}
    _CACHE[key] = (now + ttl, data)
    return data


# ---------- Atmosphere (world weather) ----------

WORLD_CITIES = [
    # name, lat, lon, country, emoji
    ("London",        51.51,   -0.13, "GB"),
    ("Paris",         48.85,    2.35, "FR"),
    ("Berlin",        52.52,   13.40, "DE"),
    ("Madrid",        40.42,   -3.70, "ES"),
    ("Rome",          41.90,   12.50, "IT"),
    ("Stockholm",     59.33,   18.07, "SE"),
    ("Reykjavik",     64.13,  -21.82, "IS"),
    ("Athens",        37.98,   23.72, "GR"),
    ("Moscow",        55.76,   37.62, "RU"),
    ("Istanbul",      41.01,   28.98, "TR"),
    ("Dublin",        53.35,   -6.26, "IE"),
    ("Lisbon",        38.72,   -9.14, "PT"),
    ("Cairo",         30.05,   31.24, "EG"),
    ("Lagos",          6.52,    3.38, "NG"),
    ("Nairobi",       -1.29,   36.82, "KE"),
    ("Cape Town",    -33.92,   18.42, "ZA"),
    ("Johannesburg", -26.20,   28.05, "ZA"),
    ("Casablanca",    33.57,   -7.59, "MA"),
    ("Dakar",         14.69,  -17.45, "SN"),
    ("Addis Ababa",    9.03,   38.74, "ET"),
    ("Tel Aviv",      32.08,   34.78, "IL"),
    ("Riyadh",        24.71,   46.68, "SA"),
    ("Dubai",         25.20,   55.27, "AE"),
    ("Tehran",        35.69,   51.39, "IR"),
    ("Tokyo",         35.69,  139.69, "JP"),
    ("Seoul",         37.57,  126.98, "KR"),
    ("Beijing",       39.90,  116.41, "CN"),
    ("Shanghai",      31.23,  121.47, "CN"),
    ("Hong Kong",     22.30,  114.17, "HK"),
    ("Taipei",        25.03,  121.57, "TW"),
    ("Manila",        14.60,  120.98, "PH"),
    ("Bangkok",       13.76,  100.50, "TH"),
    ("Singapore",      1.35,  103.82, "SG"),
    ("Jakarta",       -6.20,  106.85, "ID"),
    ("Mumbai",        19.08,   72.88, "IN"),
    ("Delhi",         28.61,   77.21, "IN"),
    ("Dhaka",         23.81,   90.41, "BD"),
    ("Kathmandu",     27.72,   85.32, "NP"),
    ("Tashkent",      41.31,   69.24, "UZ"),
    ("Novosibirsk",   55.00,   82.93, "RU"),
    ("Vladivostok",   43.12,  131.89, "RU"),
    ("Ulaanbaatar",   47.89,  106.91, "MN"),
    ("Sydney",       -33.87,  151.21, "AU"),
    ("Melbourne",    -37.81,  144.96, "AU"),
    ("Perth",        -31.95,  115.86, "AU"),
    ("Auckland",     -36.85,  174.76, "NZ"),
    ("Honolulu",      21.31, -157.86, "US"),
    ("Suva",         -18.14,  178.44, "FJ"),
    ("Port Moresby",  -9.44,  147.18, "PG"),
    ("New York",      40.71,  -74.01, "US"),
    ("Chicago",       41.88,  -87.63, "US"),
    ("Los Angeles",   34.05, -118.24, "US"),
    ("Vancouver",     49.28, -123.12, "CA"),
    ("Toronto",       43.65,  -79.38, "CA"),
    ("Mexico City",   19.43,  -99.13, "MX"),
    ("Miami",         25.76,  -80.19, "US"),
    ("Anchorage",     61.22, -149.90, "US"),
    ("Yellowknife",   62.45, -114.38, "CA"),
    ("Buenos Aires", -34.60,  -58.38, "AR"),
    ("Santiago",     -33.45,  -70.67, "CL"),
    ("Lima",         -12.05,  -77.04, "PE"),
    ("Bogota",         4.71,  -74.07, "CO"),
    ("Quito",         -0.18,  -78.47, "EC"),
    ("Caracas",       10.48,  -66.90, "VE"),
    ("Rio de Janeiro",-22.91, -43.17, "BR"),
    ("Sao Paulo",    -23.55,  -46.63, "BR"),
    ("Nuuk",          64.18,  -51.72, "GL"),
    ("Longyearbyen",  78.22,   15.65, "SJ"),
    ("Ushuaia",      -54.80,  -68.30, "AR"),
]


# ---------- Solar helpers ----------

def flux_to_class(flux):
    """Convert W/m^2 X-ray flux to GOES class letter (A/B/C/M/X) with subscale."""
    if flux is None or flux <= 0:
        return None
    if flux < 1e-7:
        letter, base = "A", 1e-8
    elif flux < 1e-6:
        letter, base = "B", 1e-7
    elif flux < 1e-5:
        letter, base = "C", 1e-6
    elif flux < 1e-4:
        letter, base = "M", 1e-5
    else:
        letter, base = "X", 1e-4
    sub = flux / base
    return f"{letter}{sub:.1f}"


# ---------- Orbital helpers ----------

_TLE_CACHE: dict = {}  # norad -> (expires_at, (name, l1, l2))

# Curated list of bright/famous satellites (LEO only — no geostationary)
TRACKED_SATS = [
    # (norad_id, display_name, category)
    # Stations — get full ground track treatment
    (48274, "Tiangong",    "station"),
    # Telescopes & science
    (20580, "Hubble",      "telescope"),
    (43613, "ICESat-2",    "science"),
    (44874, "CHEOPS",      "science"),
    # Earth observation
    (25994, "Terra",       "earth-obs"),
    (27424, "Aqua",        "earth-obs"),
    (39084, "Landsat 8",   "earth-obs"),
    (49260, "Landsat 9",   "earth-obs"),
    (27386, "ENVISAT",     "earth-obs"),
    (39634, "Sentinel-1A", "earth-obs"),
    (42063, "Sentinel-2B", "earth-obs"),
    (46984, "Sentinel-6A", "earth-obs"),
    # Weather
    (37849, "Suomi NPP",   "weather"),
    (33591, "NOAA 19",     "weather"),
    (28654, "NOAA 18",     "weather"),
    (54234, "NOAA 21",     "weather"),
    (44387, "Meteor-M2 2", "weather"),
    (40069, "Meteor-M 2",  "weather"),
]

def get_tle(norad: int, name_hint: str = "SAT") -> tuple:
    now = time.time()
    hit = _TLE_CACHE.get(norad)
    if hit and hit[0] > now:
        return hit[1]
    url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad}&FORMAT=TLE"
    req = urllib.request.Request(url, headers={"User-Agent": "world-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        text = r.read().decode("utf-8", "replace").strip()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) < 3:
        raise RuntimeError(f"Bad TLE response for {norad}")
    name = lines[0] if not lines[0].startswith("1 ") else name_hint
    idx = 1 if not lines[0].startswith("1 ") else 0
    l1 = lines[idx]; l2 = lines[idx + 1]
    entry = (name, l1, l2)
    _TLE_CACHE[norad] = (now + 6 * 3600, entry)  # TLEs update 1–2x/day
    return entry


def gmst_radians(jd_ut1: float) -> float:
    """IAU 1982 Greenwich Mean Sidereal Time in radians."""
    t = (jd_ut1 - 2451545.0) / 36525.0
    # seconds
    gmst_s = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t
    gmst_deg = (gmst_s % 86400.0) / 240.0
    return math.radians(gmst_deg % 360.0)


def eci_to_geodetic(x: float, y: float, z: float, gmst: float) -> tuple:
    """Rotate ECI (km) to ECEF then to geodetic lat/lon/alt.

    Uses WGS84 ellipsoid with iterative latitude solution — good enough
    for LEO display at sub-km accuracy.
    """
    cos_g = math.cos(gmst); sin_g = math.sin(gmst)
    xe =  x * cos_g + y * sin_g
    ye = -x * sin_g + y * cos_g
    ze =  z
    a = 6378.137
    f = 1.0 / 298.257223563
    e2 = f * (2 - f)
    r_xy = math.sqrt(xe * xe + ye * ye)
    lon = math.degrees(math.atan2(ye, xe))
    # Iterative geodetic latitude
    lat = math.atan2(ze, r_xy)
    for _ in range(6):
        sin_lat = math.sin(lat)
        N = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
        lat = math.atan2(ze + e2 * N * sin_lat, r_xy)
    sin_lat = math.sin(lat)
    N = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
    alt = r_xy / math.cos(lat) - N
    return math.degrees(lat), lon, alt


def propagate(sat: Satrec, when: datetime) -> tuple:
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second + when.microsecond * 1e-6)
    e, r, v = sat.sgp4(jd, fr)
    if e != 0:
        return None
    gmst = gmst_radians(jd + fr)
    lat, lon, alt = eci_to_geodetic(r[0], r[1], r[2], gmst)
    speed = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)  # km/s
    return lat, lon, alt, speed


def sun_subsolar(when: datetime) -> tuple:
    """Approximate subsolar point (lat, lon) in degrees."""
    # Days since J2000.0
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second + when.microsecond * 1e-6)
    d = (jd + fr) - 2451545.0
    # Mean longitude and anomaly
    L = math.radians((280.460 + 0.9856474 * d) % 360.0)
    g = math.radians((357.528 + 0.9856003 * d) % 360.0)
    # Ecliptic longitude
    lam = L + math.radians(1.915) * math.sin(g) + math.radians(0.020) * math.sin(2 * g)
    # Obliquity
    eps = math.radians(23.439 - 0.0000004 * d)
    # Right ascension and declination
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    gmst = gmst_radians(jd + fr)
    sub_lon = math.degrees(ra - gmst)
    # wrap to [-180, 180]
    sub_lon = ((sub_lon + 180) % 360) - 180
    return math.degrees(dec), sub_lon


# ---------- Wikipedia Live (Wikimedia EventStreams SSE) ----------

# Map wiki language → approximate (lat, lon) for map visualization
# Major wikis get their primary country; en spreads across anglophone world
WIKI_GEO = {
    'en': [(37,-95),(51.5,-0.1),(33.9,151.2),(-33.9,18.4),(43.7,-79.4)],
    'de': [(52.5,13.4),(48.2,16.4),(47.4,8.5)],
    'fr': [(48.9,2.3),(46.2,6.1),(14.6,-61)],
    'es': [(40.4,-3.7),(-34.6,-58.4),(19.4,-99.1),(4.7,-74.1)],
    'ja': [(35.7,139.7),(34.7,135.5)],
    'ru': [(55.8,37.6),(59.9,30.3),(56.8,60.6)],
    'zh': [(39.9,116.4),(31.2,121.5),(22.3,114.2)],
    'pt': [(38.7,-9.1),(-23.5,-46.6),(-15.8,-47.9)],
    'it': [(41.9,12.5),(45.5,9.2)],
    'ar': [(30,31.2),(24.7,46.7),(33.9,35.5)],
    'ko': [(37.6,127)],
    'pl': [(52.2,21)],
    'nl': [(52.4,4.9),(50.8,4.4)],
    'uk': [(50.4,30.5)],
    'sv': [(59.3,18.1)],
    'he': [(32.1,34.8)],
    'fi': [(60.2,25)],
    'cs': [(50.1,14.4)],
    'tr': [(41,29)],
    'id': [(-6.2,106.8)],
    'vi': [(21,105.8)],
    'th': [(13.8,100.5)],
    'fa': [(35.7,51.4)],
    'hi': [(28.6,77.2)],
    'bn': [(23.8,90.4)],
    'no': [(59.9,10.7)],
    'da': [(55.7,12.6)],
    'hu': [(47.5,19.1)],
    'ro': [(44.4,26.1)],
    'el': [(37.97,23.7)],
    'ca': [(41.4,2.2)],
    'sr': [(44.8,20.5)],
    'bg': [(42.7,23.3)],
    'commons.wikimedia': [(52.5,13.4),(48.9,2.3),(37,-95)],
    'www.wikidata': [(52.5,13.4),(48.9,2.3),(37,-95),(35.7,139.7)],
}

_wiki_buffer = deque(maxlen=300)
_wiki_lock = threading.RLock()
_wiki_stats = {"total": 0, "start_time": time.time(), "connected": False}

def _wiki_lang(server_name: str) -> str:
    """Extract language key from server_name like 'en.wikipedia.org'."""
    parts = server_name.split(".")
    if len(parts) >= 2:
        # 'en.wikipedia.org' → 'en', 'commons.wikimedia.org' → 'commons.wikimedia'
        if parts[1] in ("wikipedia", "wiktionary", "wikiquote", "wikisource"):
            return parts[0]
        return ".".join(parts[:2])
    return server_name

def _wiki_location(lang: str) -> tuple:
    """Pick a random location for a wiki language."""
    import random
    locs = WIKI_GEO.get(lang)
    if locs:
        lat, lon = random.choice(locs)
        # jitter by ±2° so dots don't stack
        return round(lat + random.uniform(-2, 2), 2), round(lon + random.uniform(-2, 2), 2)
    # Unknown wiki — random location biased toward populated areas
    return round(random.uniform(-40, 55), 2), round(random.uniform(-120, 140), 2)

def _wiki_stream_worker():
    """Background thread: consume Wikimedia EventStreams, buffer human edits."""
    import random
    while True:
        try:
            _wiki_stats["connected"] = True
            resp = req_lib.get(
                "https://stream.wikimedia.org/v2/stream/recentchange",
                stream=True, timeout=90,
                headers={"User-Agent": "world-dashboard/1.0"}
            )
            for line in resp.iter_lines():
                if not line:
                    continue
                text = line.decode("utf-8", "replace")
                if not text.startswith("data: "):
                    continue
                try:
                    d = json.loads(text[6:])
                except (json.JSONDecodeError, ValueError):
                    continue
                # Only human edits on content wikis
                if d.get("type") != "edit" or d.get("bot"):
                    continue
                wiki = d.get("server_name", "")
                # Skip minor wikis, meta, mediawiki
                if "mediawiki" in wiki or "meta.wikimedia" in wiki:
                    continue
                lang = _wiki_lang(wiki)
                lat, lon = _wiki_location(lang)
                old_len = (d.get("length") or {}).get("old", 0) or 0
                new_len = (d.get("length") or {}).get("new", 0) or 0
                evt = {
                    "ts": d.get("timestamp", 0),
                    "wiki": wiki.replace(".org", ""),
                    "lang": lang,
                    "title": (d.get("title") or "")[:80],
                    "user": (d.get("user") or "")[:30],
                    "diff": new_len - old_len,
                    "lat": lat, "lon": lon,
                    "ns": d.get("namespace", 0),
                }
                with _wiki_lock:
                    _wiki_buffer.append(evt)
                    _wiki_stats["total"] += 1
            resp.close()
        except Exception as e:
            _wiki_stats["connected"] = False
            import sys
            print(f"wiki stream error: {e}", file=sys.stderr)
        time.sleep(3)  # reconnect delay

# Start background thread
threading.Thread(target=_wiki_stream_worker, daemon=True).start()


# ---------- Near-Earth Asteroids (NASA NEO) ----------

_NEO_CACHE = {"data": None, "expires": 0}

def fetch_neo():
    """Fetch today's near-Earth asteroids from NASA."""
    now = time.time()
    if _NEO_CACHE["data"] and _NEO_CACHE["expires"] > now:
        return _NEO_CACHE["data"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    url = f"https://api.nasa.gov/neo/rest/v1/feed?start_date={today}&end_date={today}&api_key=DEMO_KEY"
    req = urllib.request.Request(url, headers={"User-Agent": "world-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        raw = json.loads(r.read())
    neos = []
    for date_key, objs in raw.get("near_earth_objects", {}).items():
        for obj in objs:
            approach = (obj.get("close_approach_data") or [{}])[0]
            diameter = obj.get("estimated_diameter", {}).get("meters", {})
            neos.append({
                "name": obj.get("name", "?").strip("()"),
                "id": obj.get("neo_reference_id"),
                "hazardous": obj.get("is_potentially_hazardous_asteroid", False),
                "mag": obj.get("absolute_magnitude_h"),
                "diameter_min": round(diameter.get("estimated_diameter_min", 0), 1),
                "diameter_max": round(diameter.get("estimated_diameter_max", 0), 1),
                "velocity_kmh": round(float(approach.get("relative_velocity", {}).get("kilometers_per_hour", 0))),
                "velocity_kms": round(float(approach.get("relative_velocity", {}).get("kilometers_per_second", 0)), 2),
                "miss_km": round(float(approach.get("miss_distance", {}).get("kilometers", 0))),
                "miss_lunar": round(float(approach.get("miss_distance", {}).get("lunar", 0)), 2),
                "miss_au": round(float(approach.get("miss_distance", {}).get("astronomical", 0)), 6),
                "approach_date": approach.get("close_approach_date_full", ""),
                "orbiting": approach.get("orbiting_body", "Earth"),
            })
    # Sort by miss distance
    neos.sort(key=lambda x: x["miss_km"])
    result = {
        "date": today,
        "count": len(neos),
        "hazardous_count": sum(1 for n in neos if n["hazardous"]),
        "closest": neos[0] if neos else None,
        "largest": max(neos, key=lambda x: x["diameter_max"]) if neos else None,
        "fastest": max(neos, key=lambda x: x["velocity_kmh"]) if neos else None,
        "asteroids": neos,
        "moon_distance_km": 384400,  # for scale reference
    }
    _NEO_CACHE["data"] = result
    _NEO_CACHE["expires"] = now + 3600  # refresh hourly
    return result


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if self.path and (self.path == "/" or self.path.endswith(".html")):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/seismic"):
            return self._seismic()
        if self.path.startswith("/api/orbital"):
            return self._orbital()
        if self.path.startswith("/api/solar"):
            return self._solar()
        if self.path.startswith("/api/atmosphere"):
            return self._atmosphere()
        if self.path.startswith("/api/population"):
            return self._population()
        if self.path.startswith("/api/volcanic"):
            return self._volcanic()
        if self.path.startswith("/api/network"):
            return self._network()
        if self.path.startswith("/api/ticker"):
            return self._ticker()
        if self.path.startswith("/api/flights"):
            return self._flights()
        if self.path.startswith("/api/weather"):
            return self._weather_events()
        if self.path.startswith("/api/markets"):
            return self._markets()
        if self.path.startswith("/api/apod"):
            return self._apod()
        if self.path.startswith("/api/trending"):
            return self._trending()
        if self.path.startswith("/api/ocean"):
            return self._ocean()
        if self.path.startswith("/api/wiki"):
            return self._wiki_live()
        if self.path.startswith("/api/asteroids"):
            return self._asteroids()
        if self.path.startswith("/api/airquality"):
            return self._air_quality()
        if self.path.startswith("/api/shipping"):
            return self._shipping()
        if self.path.startswith("/api/overview"):
            return self._overview()
        return super().do_GET()

    def _ocean(self):
        """Ocean buoy data from NOAA NDBC + ENSO index."""
        now = datetime.now(timezone.utc)
        out = {"now": now.isoformat()}
        errors = []

        # NDBC latest observations (text format)
        try:
            cache_hit = _CACHE.get("ocean:ndbc")
            if cache_hit and cache_hit[0] > time.time():
                buoys = cache_hit[1]
            else:
                req = urllib.request.Request(
                    "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt",
                    headers={"User-Agent": "world-dashboard/1.0"},
                )
                with urllib.request.urlopen(req, timeout=15) as r:
                    text = r.read().decode("utf-8", "replace")
                buoys = []
                for line in text.splitlines()[2:]:
                    parts = line.split()
                    if len(parts) < 19:
                        continue
                    try:
                        lat = float(parts[1])
                        lon = float(parts[2])
                        wtmp = parts[18]
                        if wtmp == "MM":
                            continue
                        wtmp = float(wtmp)
                        atmp = float(parts[17]) if parts[17] != "MM" else None
                        wspd = float(parts[9]) if parts[9] != "MM" else None
                        wvht = float(parts[12]) if parts[12] != "MM" else None
                        buoys.append({
                            "id": parts[0],
                            "lat": round(lat, 2),
                            "lon": round(lon, 2),
                            "wtmp": round(wtmp, 1),
                            "atmp": round(atmp, 1) if atmp else None,
                            "wspd": round(wspd, 1) if wspd else None,
                            "wvht": round(wvht, 1) if wvht else None,
                        })
                    except (ValueError, IndexError):
                        continue
                _CACHE["ocean:ndbc"] = (time.time() + 600, buoys)

            out["buoys"] = buoys
            temps = [b["wtmp"] for b in buoys]
            waves = [b["wvht"] for b in buoys if b.get("wvht") and b["wvht"] > 0]
            warmest = max(buoys, key=lambda b: b["wtmp"]) if buoys else None
            coldest = min(buoys, key=lambda b: b["wtmp"]) if buoys else None
            out["stats"] = {
                "buoy_count": len(buoys),
                "temp_min": round(min(temps), 1) if temps else None,
                "temp_max": round(max(temps), 1) if temps else None,
                "temp_avg": round(sum(temps) / len(temps), 1) if temps else None,
                "wave_reports": len(waves),
                "wave_max": round(max(waves), 1) if waves else None,
                "wave_avg": round(sum(waves) / len(waves), 1) if waves else None,
                "warmest": {"id": warmest["id"], "temp": warmest["wtmp"],
                            "lat": warmest["lat"], "lon": warmest["lon"]} if warmest else None,
                "coldest": {"id": coldest["id"], "temp": coldest["wtmp"],
                            "lat": coldest["lat"], "lon": coldest["lon"]} if coldest else None,
            }
        except Exception as e:
            errors.append(f"ndbc: {e}")
            out["buoys"] = []
            out["stats"] = {}

        # ENSO Niño 3.4 index
        try:
            enso_hit = _CACHE.get("ocean:enso")
            if enso_hit and enso_hit[0] > time.time():
                out["enso"] = enso_hit[1]
            else:
                req = urllib.request.Request(
                    "https://psl.noaa.gov/data/correlation/nina34.anom.data",
                    headers={"User-Agent": "world-dashboard/1.0"},
                )
                with urllib.request.urlopen(req, timeout=10) as r:
                    text = r.read().decode("utf-8", "replace")
                # Parse: year + 12 monthly values
                latest_val = None
                latest_label = ""
                months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
                for line in text.strip().splitlines():
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    try:
                        yr = int(parts[0])
                        if yr < 2020:
                            continue
                        for mi, val in enumerate(parts[1:13]):
                            v = float(val)
                            if v > -90:
                                latest_val = v
                                latest_label = f"{months[mi]} {yr}"
                    except ValueError:
                        continue
                status = "Neutral"
                if latest_val is not None:
                    if latest_val <= -0.5:
                        status = "La Niña"
                    elif latest_val >= 0.5:
                        status = "El Niño"
                enso = {"value": latest_val, "label": latest_label, "status": status}
                _CACHE["ocean:enso"] = (time.time() + 3600, enso)
                out["enso"] = enso
        except Exception as e:
            errors.append(f"enso: {e}")

        if errors:
            out["errors"] = errors
        self._send_json(out)

    def _trending(self):
        """GitHub trending repos + Hacker News top stories."""
        now = datetime.now(timezone.utc)
        out = {"now": now.isoformat()}
        errors = []

        # GitHub: repos created in last 7 days, sorted by stars
        try:
            week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
            gh = cached_fetch(
                "trending:github",
                f"https://api.github.com/search/repositories?q=created:>{week_ago}&sort=stars&order=desc&per_page=20",
                ttl=600.0,
                stale_ok=True,
                timeout=10.0,
            )
            repos = []
            for r in gh.get("items", [])[:20]:
                repos.append({
                    "name": r.get("full_name"),
                    "stars": r.get("stargazers_count"),
                    "lang": r.get("language"),
                    "desc": (r.get("description") or "")[:100],
                    "url": r.get("html_url"),
                })
            out["github"] = repos
            out["github_total"] = gh.get("total_count", 0)
        except Exception as e:
            errors.append(f"github: {e}")

        # Hacker News: top 15 stories
        try:
            hn_hit = _CACHE.get("trending:hn_full")
            if hn_hit and hn_hit[0] > time.time():
                out["hackernews"] = hn_hit[1]
            else:
                ids_raw = cached_fetch(
                    "trending:hn_ids",
                    "https://hacker-news.firebaseio.com/v0/topstories.json",
                    ttl=300.0,
                    timeout=8.0,
                )
                stories = []
                for sid in (ids_raw or [])[:15]:
                    try:
                        url = f"https://hacker-news.firebaseio.com/v0/item/{sid}.json"
                        req = urllib.request.Request(url, headers={"User-Agent": "world-dashboard/1.0"})
                        with urllib.request.urlopen(req, timeout=5) as rr:
                            s = json.loads(rr.read())
                        stories.append({
                            "title": s.get("title"),
                            "score": s.get("score"),
                            "by": s.get("by"),
                            "comments": s.get("descendants", 0),
                            "url": s.get("url", f"https://news.ycombinator.com/item?id={sid}"),
                        })
                    except Exception:
                        continue
                _CACHE["trending:hn_full"] = (time.time() + 300, stories)
                out["hackernews"] = stories
        except Exception as e:
            errors.append(f"hackernews: {e}")

        if errors:
            out["errors"] = errors
        self._send_json(out)

    def _apod(self):
        """NASA Astronomy Picture of the Day."""
        # Proxy the image to avoid CORS issues
        if "img" in self.path:
            hit = _CACHE.get("nasa:apod")
            if hit and hit[0] > time.time():
                img_url = hit[1].get("url")
                if img_url:
                    try:
                        req = urllib.request.Request(img_url, headers={"User-Agent": "world-dashboard/1.0"})
                        with urllib.request.urlopen(req, timeout=15) as r:
                            img_data = r.read()
                            ct = r.headers.get("Content-Type", "image/jpeg")
                        self.send_response(200)
                        self.send_header("Content-Type", ct)
                        self.send_header("Content-Length", str(len(img_data)))
                        self.send_header("Cache-Control", "max-age=3600")
                        self.end_headers()
                        self.wfile.write(img_data)
                        return
                    except Exception:
                        pass
            self.send_error(404)
            return

        try:
            data = cached_fetch(
                "nasa:apod",
                "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY",
                ttl=3600.0,
                stale_ok=True,
                timeout=20.0,
            )
        except Exception as e:
            return self._send_json({"error": str(e)}, status=502)

        self._send_json({
            "title": data.get("title"),
            "date": data.get("date"),
            "explanation": data.get("explanation"),
            "media_type": data.get("media_type"),
            "url": "/api/apod/img",
            "original_url": data.get("url"),
            "hdurl": data.get("hdurl"),
            "copyright": data.get("copyright"),
        })

    def _ticker(self):
        """BBC World News headlines for the ticker bar."""
        import xml.etree.ElementTree as ET

        now = time.time()
        hit = _CACHE.get("ticker:bbc_parsed")
        if hit and hit[0] > now:
            return self._send_json(hit[1])

        try:
            req = urllib.request.Request(
                "https://feeds.bbci.co.uk/news/world/rss.xml",
                headers={"User-Agent": "world-dashboard/1.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                xml_bytes = r.read()
            root = ET.fromstring(xml_bytes)
            items = root.findall(".//item")
            headlines = []
            for item in items[:20]:
                title = item.findtext("title", "")
                pub = item.findtext("pubDate", "")
                link = item.findtext("link", "")
                headlines.append({"title": title, "pub": pub[:16], "link": link})
            result = {"headlines": headlines, "count": len(headlines)}
            _CACHE["ticker:bbc_parsed"] = (now + 600, result)
            return self._send_json(result)
        except Exception as e:
            return self._send_json({"headlines": [], "error": str(e)})

    def _markets(self):
        """Crypto markets from CoinGecko (free, no key)."""
        now = datetime.now(timezone.utc)
        out = {"now": now.isoformat()}
        errors = []

        coins = ["bitcoin", "ethereum", "solana", "dogecoin", "cardano", "ripple",
                 "polkadot", "avalanche-2", "chainlink", "litecoin"]

        # Prices
        try:
            ids = ",".join(coins)
            prices = cached_fetch(
                "markets:prices",
                f"https://api.coingecko.com/api/v3/simple/price?ids={ids}"
                f"&vs_currencies=usd,gbp&include_24hr_change=true&include_market_cap=true",
                ttl=120.0,
            )
            coin_data = []
            for cid in coins:
                p = prices.get(cid)
                if not p:
                    continue
                name = cid.replace("-2", "").replace("-", " ").title()
                if cid == "ripple":
                    name = "XRP"
                elif cid == "avalanche-2":
                    name = "Avalanche"
                coin_data.append({
                    "id": cid,
                    "name": name,
                    "usd": p.get("usd"),
                    "gbp": p.get("gbp"),
                    "change_24h": round(p.get("usd_24h_change") or 0, 2),
                    "market_cap": p.get("usd_market_cap"),
                })
            out["coins"] = coin_data
        except Exception as e:
            errors.append(f"prices: {e}")

        # Global market data
        try:
            gdata = cached_fetch(
                "markets:global",
                "https://api.coingecko.com/api/v3/global",
                ttl=300.0,
            )
            d = gdata.get("data", {})
            out["global"] = {
                "total_market_cap": d.get("total_market_cap", {}).get("usd"),
                "total_volume_24h": d.get("total_volume", {}).get("usd"),
                "btc_dominance": round(d.get("market_cap_percentage", {}).get("btc", 0), 1),
                "eth_dominance": round(d.get("market_cap_percentage", {}).get("eth", 0), 1),
                "active_cryptos": d.get("active_cryptocurrencies"),
                "markets": d.get("markets"),
                "market_cap_change_24h": round(d.get("market_cap_change_percentage_24h_usd", 0), 2),
            }
        except Exception as e:
            errors.append(f"global: {e}")

        # Fear & Greed Index
        try:
            fng = cached_fetch(
                "markets:fng",
                "https://api.alternative.me/fng/?limit=30",
                ttl=600.0,
            )
            fng_data = fng.get("data", [])
            if fng_data:
                out["fear_greed"] = {
                    "value": int(fng_data[0].get("value", 0)),
                    "label": fng_data[0].get("value_classification", ""),
                    "history": [int(x.get("value", 0)) for x in fng_data],
                }
        except Exception as e:
            errors.append(f"fng: {e}")

        # BTC 7-day sparkline
        try:
            spark = cached_fetch(
                "markets:btc_spark",
                "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=hourly",
                ttl=600.0,
            )
            prices_arr = spark.get("prices", [])
            out["btc_sparkline"] = [round(p[1]) for p in prices_arr]
        except Exception as e:
            errors.append(f"sparkline: {e}")

        if errors:
            out["errors"] = errors
        self._send_json(out)

    def _weather_events(self):
        """Global weather events from GDACS + NWS + Open-Meteo extremes."""
        now = datetime.now(timezone.utc)
        out = {"now": now.isoformat()}
        errors = []

        # GDACS events (last 14 days)
        gdacs_events = []
        try:
            from_date = (now - timedelta(days=14)).strftime("%Y-%m-%d")
            gdata = cached_fetch(
                "weather:gdacs",
                f"https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
                f"?eventlist=EQ,TC,FL,VO,DR,WF&alertlevel=Green;Orange;Red&fromDate={from_date}",
                ttl=600.0,
                timeout=15.0,
            )
            for f in gdata.get("features", []):
                p = f.get("properties", {})
                g = f.get("geometry", {})
                coords = g.get("coordinates", [None, None])
                gdacs_events.append({
                    "type": p.get("eventtype"),
                    "name": p.get("name"),
                    "alert": p.get("alertlevel"),
                    "country": p.get("country"),
                    "lon": coords[0] if coords else None,
                    "lat": coords[1] if coords else None,
                    "from": p.get("fromdate"),
                    "to": p.get("todate"),
                    "description": (p.get("description") or "")[:200],
                    "url": (p.get("url") or {}).get("report"),
                    "severity": (p.get("severitydata") or {}).get("severitytext", ""),
                })
        except Exception as e:
            errors.append(f"gdacs: {e}")

        # NWS US alerts
        nws_count = 0
        nws_areas = 0
        try:
            nws = cached_fetch(
                "weather:nws_count",
                "https://api.weather.gov/alerts/active/count",
                ttl=300.0,
                timeout=8.0,
            )
            nws_count = nws.get("total", 0)
            nws_areas = len(nws.get("areas", {}))
        except Exception as e:
            errors.append(f"nws: {e}")

        # Open-Meteo extremes for all cities — wind gusts + precip + weather code
        city_extremes = []
        try:
            lats = ",".join(f"{c[1]}" for c in WORLD_CITIES)
            lons = ",".join(f"{c[2]}" for c in WORLD_CITIES)
            edata = cached_fetch(
                "weather:extremes",
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={lats}&longitude={lons}"
                f"&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation"
                f"&timezone=UTC&forecast_days=1",
                ttl=600.0,
                timeout=15.0,
            )
            if not isinstance(edata, list):
                edata = [edata]
            for i, entry in enumerate(edata):
                if i >= len(WORLD_CITIES):
                    break
                name, lat, lon, country = WORLD_CITIES[i]
                cur = entry.get("current", {})
                gusts = cur.get("wind_gusts_10m")
                precip = cur.get("precipitation")
                wcode = cur.get("weather_code")
                temp = cur.get("temperature_2m")
                wind = cur.get("wind_speed_10m")
                # Flag severe conditions
                severe = False
                reason = []
                if gusts and gusts >= 80:
                    severe = True; reason.append(f"gusts {gusts:.0f}km/h")
                if precip and precip >= 5:
                    severe = True; reason.append(f"precip {precip:.1f}mm/h")
                if wcode and wcode >= 95:
                    severe = True; reason.append("thunderstorm")
                if temp and temp >= 40:
                    severe = True; reason.append(f"extreme heat {temp:.0f}°")
                if temp and temp <= -25:
                    severe = True; reason.append(f"extreme cold {temp:.0f}°")
                city_extremes.append({
                    "name": name, "country": country,
                    "lat": lat, "lon": lon,
                    "temp": temp, "wind": wind, "gusts": gusts,
                    "precip": precip, "wcode": wcode,
                    "severe": severe, "reason": ", ".join(reason),
                })
        except Exception as e:
            errors.append(f"extremes: {e}")

        # Stats
        alert_counts = {"Red": 0, "Orange": 0, "Green": 0}
        type_counts = {}
        for ev in gdacs_events:
            alert_counts[ev.get("alert", "Green")] = alert_counts.get(ev.get("alert", "Green"), 0) + 1
            type_counts[ev.get("type", "?")] = type_counts.get(ev.get("type", "?"), 0) + 1

        severe_cities = [c for c in city_extremes if c["severe"]]
        gustiest = max(city_extremes, key=lambda c: c.get("gusts") or 0) if city_extremes else None
        wettest = max(city_extremes, key=lambda c: c.get("precip") or 0) if city_extremes else None

        out.update({
            "gdacs": gdacs_events,
            "gdacs_stats": {
                "total": len(gdacs_events),
                "alerts": alert_counts,
                "types": type_counts,
            },
            "nws": {"total": nws_count, "areas": nws_areas},
            "extremes": city_extremes,
            "severe_cities": severe_cities,
            "gustiest": {"name": gustiest["name"], "gusts": gustiest.get("gusts")} if gustiest else None,
            "wettest": {"name": wettest["name"], "precip": wettest.get("precip")} if wettest else None,
        })
        if errors:
            out["errors"] = errors
        self._send_json(out)

    def _flights(self):
        """Live aircraft positions from OpenSky Network."""
        try:
            data = cached_fetch(
                "opensky:all",
                "https://opensky-network.org/api/states/all",
                ttl=600.0,
                stale_ok=True,
                timeout=20.0,
            )
        except Exception as e:
            return self._send_json({
                "error": f"OpenSky rate-limited — resets daily. {e}",
                "aircraft": [],
                "stats": {"total": 0, "airborne": 0, "on_ground": 0,
                          "no_position": 0, "countries": 0, "avg_alt_ft": 0, "max_alt_ft": 0},
                "top_countries": [],
                "rate_limited": True,
            })

        states = data.get("states", [])
        # State vector indices: 0=icao24, 1=callsign, 2=origin_country,
        # 5=longitude, 6=latitude, 7=baro_altitude, 8=on_ground, 9=velocity, 10=true_track
        aircraft = []
        countries = {}
        on_ground = 0
        alts = []
        for s in states:
            lon = s[5]
            lat = s[6]
            if lon is None or lat is None:
                continue
            alt = s[7]  # meters
            vel = s[9]  # m/s
            track = s[10]  # degrees from north
            grounded = s[8]
            origin = s[2] or "unknown"
            countries[origin] = countries.get(origin, 0) + 1
            if grounded:
                on_ground += 1
                continue  # skip grounded aircraft for map
            if alt is not None:
                alts.append(alt)
            aircraft.append([
                round(lon, 2),
                round(lat, 2),
                round(alt / 304.8) if alt else 0,  # FL (flight level in hundreds of feet)
                round(track or 0),
            ])

        top_countries = sorted(countries.items(), key=lambda x: -x[1])[:25]

        stats = {
            "total": len(states),
            "airborne": len(aircraft),
            "on_ground": on_ground,
            "no_position": len(states) - len(aircraft) - on_ground,
            "countries": len(countries),
            "avg_alt_ft": round(sum(alts) / len(alts) * 3.281) if alts else 0,
            "max_alt_ft": round(max(alts) * 3.281) if alts else 0,
        }

        self._send_json({
            "now": datetime.now(timezone.utc).isoformat(),
            "time": data.get("time"),
            "aircraft": aircraft,  # [lon, lat, FL, track]
            "stats": stats,
            "top_countries": [{"country": c, "count": n} for c, n in top_countries],
        })

    def _wiki_live(self):
        """Recent Wikipedia edits from the SSE background worker."""
        with _wiki_lock:
            events = list(_wiki_buffer)
        elapsed = max(1, time.time() - _wiki_stats["start_time"])
        # Aggregate stats
        by_wiki = {}
        by_user = {}
        for e in events:
            w = e["wiki"]
            by_wiki[w] = by_wiki.get(w, 0) + 1
            u = e["user"]
            by_user[u] = by_user.get(u, 0) + 1
        top_wikis = sorted(by_wiki.items(), key=lambda x: -x[1])[:15]
        top_editors = sorted(by_user.items(), key=lambda x: -x[1])[:10]
        edits_per_min = _wiki_stats["total"] / (elapsed / 60) if elapsed > 10 else 0
        self._send_json({
            "events": events[-200:],  # latest 200
            "total_seen": _wiki_stats["total"],
            "buffer_size": len(events),
            "edits_per_min": round(edits_per_min, 1),
            "connected": _wiki_stats["connected"],
            "uptime_s": round(elapsed),
            "top_wikis": [{"wiki": w, "count": n} for w, n in top_wikis],
            "top_editors": [{"user": u, "count": n} for u, n in top_editors],
        })

    def _asteroids(self):
        """Near-Earth asteroids from NASA NEO API."""
        try:
            data = fetch_neo()
            self._send_json(data)
        except Exception as e:
            self._send_json({"error": str(e)}, status=502)

    def _air_quality(self):
        """Air quality for world cities via Open-Meteo Air Quality API."""
        try:
            lats = ",".join(f"{c[1]}" for c in WORLD_CITIES)
            lons = ",".join(f"{c[2]}" for c in WORLD_CITIES)
            url = (
                f"https://air-quality-api.open-meteo.com/v1/air-quality?"
                f"latitude={lats}&longitude={lons}"
                f"&current=pm2_5,pm10,us_aqi,european_aqi,nitrogen_dioxide,ozone"
                f"&timezone=auto"
            )
            data = cached_fetch("airquality", url, ttl=600)
            cities = []
            if isinstance(data, list):
                for i, d in enumerate(data):
                    if i >= len(WORLD_CITIES):
                        break
                    name, lat, lon, country = WORLD_CITIES[i]
                    c = d.get("current", {})
                    aqi = c.get("us_aqi")
                    if aqi is None:
                        continue
                    cities.append({
                        "name": name, "country": country,
                        "lat": lat, "lon": lon,
                        "aqi": aqi,
                        "eu_aqi": c.get("european_aqi"),
                        "pm25": c.get("pm2_5"),
                        "pm10": c.get("pm10"),
                        "no2": c.get("nitrogen_dioxide"),
                        "o3": c.get("ozone"),
                    })
            # Sort by AQI descending for rankings
            cities.sort(key=lambda x: x["aqi"], reverse=True)
            # AQI category breakdown
            good = sum(1 for c in cities if c["aqi"] <= 50)
            moderate = sum(1 for c in cities if 50 < c["aqi"] <= 100)
            unhealthy_sg = sum(1 for c in cities if 100 < c["aqi"] <= 150)
            unhealthy = sum(1 for c in cities if 150 < c["aqi"] <= 200)
            very_unhealthy = sum(1 for c in cities if 200 < c["aqi"] <= 300)
            hazardous = sum(1 for c in cities if c["aqi"] > 300)
            self._send_json({
                "cities": cities,
                "count": len(cities),
                "worst": cities[0] if cities else None,
                "best": cities[-1] if cities else None,
                "breakdown": {
                    "good": good, "moderate": moderate,
                    "unhealthy_sg": unhealthy_sg, "unhealthy": unhealthy,
                    "very_unhealthy": very_unhealthy, "hazardous": hazardous,
                },
            })
        except Exception as e:
            self._send_json({"error": str(e)}, status=502)

    def _shipping(self):
        """Global shipping — IMF PortWatch chokepoint transit data.

        Covers 28 major maritime chokepoints (Hormuz, Suez, Malacca, Bab el-Mandeb,
        Panama, Bosporus, Dover, Gibraltar, etc). Daily vessel transit counts broken
        down by type (tanker / container / dry bulk / cargo / roro) with DWT capacity.
        Data is AIS-derived by IMF-Oxford; ~2-3 day lag; updates daily.
        """
        try:
            now = datetime.now(timezone.utc)

            # Chokepoint metadata — annual counts + lat/lon (cache 24h; rarely changes)
            meta = cached_fetch(
                "shipping:meta",
                "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
                "PortWatch_chokepoints_database/FeatureServer/0/query"
                "?where=1%3D1&outFields=portid,portname,fullname,lat,lon,"
                "vessel_count_total,vessel_count_tanker,vessel_count_container,"
                "vessel_count_dry_bulk,vessel_count_general_cargo,vessel_count_RoRo,"
                "industry_top1,industry_top2,industry_top3"
                "&returnGeometry=false&f=json",
                ttl=86400,
                timeout=20,
                stale_ok=True,
            )

            # Daily data — last ~35 days for all 28 chokepoints (≤1000 rows)
            cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
            daily = cached_fetch(
                "shipping:daily",
                "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
                "Daily_Chokepoints_Data/FeatureServer/0/query"
                f"?where=date%20%3E%3D%20TIMESTAMP%20'{cutoff}'"
                "&outFields=date,portid,portname,n_total,n_tanker,n_container,"
                "n_cargo,n_dry_bulk,n_general_cargo,n_roro,capacity_tanker,capacity"
                "&orderByFields=date%20DESC&resultRecordCount=2000&f=json",
                ttl=21600,  # 6 hours
                timeout=20,
                stale_ok=True,
            )

            # Build per-chokepoint history map
            history = {}  # portid -> list of {date, n_total, n_tanker, ...}
            for row in daily.get("features", []):
                a = row["attributes"]
                pid = a.get("portid")
                if not pid:
                    continue
                history.setdefault(pid, []).append({
                    "date": a.get("date"),
                    "n_total": a.get("n_total") or 0,
                    "n_tanker": a.get("n_tanker") or 0,
                    "n_container": a.get("n_container") or 0,
                    "n_cargo": a.get("n_cargo") or 0,
                    "n_dry_bulk": a.get("n_dry_bulk") or 0,
                    "n_general_cargo": a.get("n_general_cargo") or 0,
                    "n_roro": a.get("n_roro") or 0,
                    "capacity_tanker": a.get("capacity_tanker") or 0,
                    "capacity": a.get("capacity") or 0,
                })
            # Sort each series chronologically (oldest → newest)
            for pid, series in history.items():
                series.sort(key=lambda r: r["date"] or 0)
                # Keep last 30 days
                history[pid] = series[-30:]

            # Merge meta with computed stats
            chokepoints = []
            for row in meta.get("features", []):
                a = row["attributes"]
                pid = a.get("portid")
                series = history.get(pid, [])
                if not series:
                    continue
                latest = series[-1]
                # 7-day avg (last 7 points in series, if available)
                last7 = series[-7:]
                avg7 = sum(r["n_total"] for r in last7) / len(last7) if last7 else 0
                avg7_tanker = sum(r["n_tanker"] for r in last7) / len(last7) if last7 else 0
                # 28-day baseline
                avg28 = sum(r["n_total"] for r in series) / len(series) if series else 0
                # delta % vs 28-day baseline
                delta_pct = ((latest["n_total"] - avg28) / avg28 * 100) if avg28 else 0
                chokepoints.append({
                    "id": pid,
                    "name": a.get("portname"),
                    "fullname": a.get("fullname") or a.get("portname"),
                    "lat": a.get("lat"),
                    "lon": a.get("lon"),
                    "annual_total": a.get("vessel_count_total"),
                    "annual_tanker": a.get("vessel_count_tanker"),
                    "annual_container": a.get("vessel_count_container"),
                    "annual_dry_bulk": a.get("vessel_count_dry_bulk"),
                    "annual_general_cargo": a.get("vessel_count_general_cargo"),
                    "annual_roro": a.get("vessel_count_RoRo"),
                    "industry_top1": a.get("industry_top1"),
                    "industry_top2": a.get("industry_top2"),
                    "industry_top3": a.get("industry_top3"),
                    "latest_date": latest["date"],
                    "latest_total": latest["n_total"],
                    "latest_tanker": latest["n_tanker"],
                    "latest_container": latest["n_container"],
                    "latest_cargo": latest["n_cargo"],
                    "latest_dry_bulk": latest["n_dry_bulk"],
                    "latest_roro": latest["n_roro"],
                    "latest_capacity": latest["capacity"],
                    "latest_capacity_tanker": latest["capacity_tanker"],
                    "avg7": round(avg7, 1),
                    "avg7_tanker": round(avg7_tanker, 1),
                    "avg28": round(avg28, 1),
                    "delta_pct": round(delta_pct, 1),
                    # compact history arrays for sparklines (total + tanker)
                    "hist_total": [r["n_total"] for r in series],
                    "hist_tanker": [r["n_tanker"] for r in series],
                    "hist_dates": [r["date"] for r in series],
                })

            # Sort by latest total (busiest first)
            chokepoints.sort(key=lambda c: c["latest_total"], reverse=True)

            latest_date = max((c["latest_date"] for c in chokepoints if c["latest_date"]), default=None)
            self._send_json({
                "now": now.isoformat(),
                "latest_date": latest_date,
                "count": len(chokepoints),
                "chokepoints": chokepoints,
                "focus": "chokepoint6",  # Strait of Hormuz
                "source": "IMF PortWatch · Oxford (AIS-derived)",
            })
        except Exception as e:
            self._send_json({"error": str(e)}, status=502)

    def _overview(self):
        """One headline stat from each tab — for the landing page."""
        now = datetime.now(timezone.utc)
        out = {"now": now.isoformat(), "headlines": []}
        h = out["headlines"]

        # Seismic
        try:
            d = cached_fetch("seismic:day", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", ttl=60.0)
            feats = d.get("features", [])
            mags = [f["properties"]["mag"] for f in feats if f.get("properties", {}).get("mag") is not None]
            h.append({"tab": "seismic", "icon": "◉", "label": "Seismic", "value": f"{len(mags)} quakes", "detail": f"max M{max(mags):.1f}" if mags else "quiet", "color": "#5fd1ff"})
        except Exception:
            h.append({"tab": "seismic", "icon": "◉", "label": "Seismic", "value": "—", "detail": "offline", "color": "#5fd1ff"})

        # Orbital
        try:
            name_tle, l1, l2 = get_tle(25544, "ISS")
            sat = Satrec.twoline2rv(l1, l2)
            cur = propagate(sat, now)
            if cur:
                lat, lon, alt, speed = cur
                n_tracked = 2 + len(TRACKED_SATS) - 1  # ISS + Tiangong + rest
                h.append({"tab": "orbital", "icon": "◎", "label": "ISS", "value": f"{alt:.0f} km alt", "detail": f"tracking {n_tracked} objects", "color": "#5fd1ff"})
            else:
                raise RuntimeError("sgp4 fail")
        except Exception:
            h.append({"tab": "orbital", "icon": "◎", "label": "ISS", "value": "—", "detail": "offline", "color": "#5fd1ff"})

        # Solar — use cached Kp if available
        try:
            kp_data = cached_fetch("swpc:kp", "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", ttl=300)
            kp_val = float(kp_data[-1]["Kp"]) if kp_data else None
            g = "G0"
            if kp_val and kp_val >= 5: g = "G1"
            if kp_val and kp_val >= 6: g = "G2"
            if kp_val and kp_val >= 7: g = "G3"
            h.append({"tab": "solar", "icon": "☀", "label": "Solar", "value": f"Kp {kp_val:.1f}" if kp_val else "—", "detail": g, "color": "#ffd64a"})
        except Exception:
            h.append({"tab": "solar", "icon": "☀", "label": "Solar", "value": "—", "detail": "offline", "color": "#ffd64a"})

        # Atmosphere
        try:
            atmos = _CACHE.get("atmos:cities")
            if atmos and atmos[0] > time.time():
                data = atmos[1]
                cities = []
                for i, entry in enumerate(data):
                    if i >= len(WORLD_CITIES): break
                    cur_w = entry.get("current", {})
                    t = cur_w.get("temperature_2m")
                    if t is not None:
                        cities.append((WORLD_CITIES[i][0], t))
                if cities:
                    cities.sort(key=lambda x: x[1])
                    cold = cities[0]
                    hot = cities[-1]
                    h.append({"tab": "atmosphere", "icon": "◈", "label": "Weather", "value": f"{hot[1]:.0f}°→{cold[1]:.0f}°", "detail": f"{hot[0]}→{cold[0]}", "color": "#ffb347"})
                else:
                    raise RuntimeError("no data")
            else:
                raise RuntimeError("no cache")
        except Exception:
            h.append({"tab": "atmosphere", "icon": "◈", "label": "Weather", "value": "—", "detail": "loading", "color": "#ffb347"})

        # Population
        base_date = datetime(2023, 7, 1, tzinfo=timezone.utc)
        base_pop = 8_064_057_930
        growth_rate = 8.7466
        years = (now - base_date).total_seconds() / (365.25 * 86400)
        pop = base_pop * (1 + growth_rate / 1000) ** years
        h.append({"tab": "population", "icon": "◌", "label": "Population", "value": f"{pop/1e9:.3f}B", "detail": "+2.3/sec", "color": "#a0e84a"})

        # Volcanic
        try:
            vdata = _CACHE.get("eonet:volcanoes")
            odata = _CACHE.get("eonet:open")
            active_v = 0
            fires = 0
            storms = 0
            if vdata and vdata[0] > time.time():
                active_v = sum(1 for e in vdata[1].get("events", []) if not e.get("closed"))
            if odata and odata[0] > time.time():
                for e in odata[1].get("events", []):
                    cats = [c["id"] for c in e.get("categories", [])]
                    if "wildfires" in cats: fires += 1
                    elif "severeStorms" in cats: storms += 1
            h.append({"tab": "volcanic", "icon": "▲", "label": "Hazards", "value": f"{active_v} volcanoes", "detail": f"{fires} fires · {storms} storms", "color": "#ff4d6d"})
        except Exception:
            h.append({"tab": "volcanic", "icon": "▲", "label": "Hazards", "value": "—", "detail": "loading", "color": "#ff4d6d"})

        # Network
        try:
            score_data = _CACHE.get("net:score")
            speed_data = _CACHE.get("net:speed")
            score = None
            dl = None
            if score_data and score_data[0] > time.time():
                rows = score_data[1].get("data", [])
                if rows: score = rows[0].get("score")
            if speed_data and speed_data[0] > time.time():
                r = speed_data[1].get("result", {})
                dl = r.get("download_mbps")
            val = f"{score:.0f}/100" if score else "—"
            det = f"↓{dl:.0f} Mbps" if dl else "loading"
            h.append({"tab": "network", "icon": "✦", "label": "Network", "value": val, "detail": det, "color": "#a855f7"})
        except Exception:
            h.append({"tab": "network", "icon": "✦", "label": "Network", "value": "—", "detail": "loading", "color": "#a855f7"})

        # Flights
        try:
            osky = _CACHE.get("opensky:all")
            if osky and osky[0] > time.time():
                states = osky[1].get("states", [])
                airborne = sum(1 for s in states if s[5] is not None and s[6] is not None and not s[8])
                h.append({"tab": "flights", "icon": "✈", "label": "Flights", "value": f"{airborne:,} airborne", "detail": "live ADS-B", "color": "#ffd64a"})
            else:
                raise RuntimeError("no cache")
        except Exception:
            h.append({"tab": "flights", "icon": "✈", "label": "Flights", "value": "—", "detail": "loading", "color": "#ffd64a"})

        # Weather
        try:
            gdacs_c = _CACHE.get("weather:gdacs")
            if gdacs_c and gdacs_c[0] > time.time():
                feats = gdacs_c[1].get("features", [])
                red = sum(1 for f in feats if f.get("properties", {}).get("alertlevel") == "Red")
                h.append({"tab": "weather", "icon": "⚡", "label": "Weather", "value": f"{len(feats)} events", "detail": f"{red} red alerts", "color": "#ff4d6d"})
            else:
                raise RuntimeError("no cache")
        except Exception:
            h.append({"tab": "weather", "icon": "⚡", "label": "Weather", "value": "—", "detail": "loading", "color": "#ff4d6d"})

        # Markets
        try:
            prices_c = _CACHE.get("markets:prices")
            fng_c = _CACHE.get("markets:fng")
            if prices_c and prices_c[0] > time.time():
                btc_p = prices_c[1].get("bitcoin", {}).get("usd")
                fng_val = None
                if fng_c and fng_c[0] > time.time():
                    fng_data = fng_c[1].get("data", [])
                    if fng_data:
                        fng_val = fng_data[0].get("value")
                val = f"${btc_p:,.0f}" if btc_p else "—"
                det = f"F&G {fng_val}" if fng_val else "loading"
                h.append({"tab": "markets", "icon": "₿", "label": "Markets", "value": val, "detail": det, "color": "#ffb347"})
            else:
                raise RuntimeError("no cache")
        except Exception:
            h.append({"tab": "markets", "icon": "₿", "label": "Markets", "value": "—", "detail": "loading", "color": "#ffb347"})

        # Space (APOD)
        try:
            apod_c = _CACHE.get("nasa:apod")
            if apod_c and apod_c[0] > time.time():
                title = apod_c[1].get("title", "")
                h.append({"tab": "space", "icon": "🔭", "label": "Space", "value": title[:25], "detail": apod_c[1].get("date", ""), "color": "#a855f7"})
            else:
                raise RuntimeError("no cache")
        except Exception:
            h.append({"tab": "space", "icon": "🔭", "label": "Space", "value": "—", "detail": "loading", "color": "#a855f7"})

        # Trending
        try:
            gh_c = _CACHE.get("trending:github")
            hn_c = _CACHE.get("trending:hn_full")
            gh_top = ""
            hn_top = ""
            if gh_c and gh_c[0] > time.time():
                items = gh_c[1].get("items", [])
                if items:
                    gh_top = items[0].get("full_name", "")[:20]
            if hn_c and hn_c[0] > time.time() and hn_c[1]:
                hn_top = hn_c[1][0].get("title", "")[:25] if hn_c[1] else ""
            val = gh_top or "—"
            det = hn_top or "loading"
            h.append({"tab": "trending", "icon": "🔥", "label": "Trending", "value": val, "detail": det, "color": "#ff4d6d"})
        except Exception:
            h.append({"tab": "trending", "icon": "🔥", "label": "Trending", "value": "—", "detail": "loading", "color": "#ff4d6d"})

        # Wikipedia Live
        try:
            elapsed = max(1, time.time() - _wiki_stats["start_time"])
            epm = round(_wiki_stats["total"] / (elapsed / 60)) if elapsed > 10 else 0
            with _wiki_lock:
                buf = len(_wiki_buffer)
            h.append({"tab": "wiki", "icon": "📝", "label": "Wikipedia", "value": f"{epm}/min", "detail": f"{buf} buffered", "color": "#4ecdc4"})
        except Exception:
            h.append({"tab": "wiki", "icon": "📝", "label": "Wikipedia", "value": "—", "detail": "loading", "color": "#4ecdc4"})

        # Asteroids
        try:
            neo = fetch_neo()
            h.append({"tab": "asteroids", "icon": "☄", "label": "Asteroids", "value": f"{neo['count']} today", "detail": f"{neo['hazardous_count']} hazardous", "color": "#ff9f1c"})
        except Exception:
            h.append({"tab": "asteroids", "icon": "☄", "label": "Asteroids", "value": "—", "detail": "loading", "color": "#ff9f1c"})

        # Air Quality
        try:
            aq = cached_fetch("airquality", None, ttl=0)  # use existing cache only
            if aq and isinstance(aq, list):
                cities_aq = []
                for i, d in enumerate(aq):
                    if i >= len(WORLD_CITIES): break
                    c = d.get("current", {})
                    aqi = c.get("us_aqi")
                    if aqi is not None:
                        cities_aq.append((WORLD_CITIES[i][0], aqi))
                if cities_aq:
                    worst = max(cities_aq, key=lambda x: x[1])
                    haz = sum(1 for _, a in cities_aq if a > 150)
                    h.append({"tab": "airquality", "icon": "🌬", "label": "Air Quality", "value": f"AQI {worst[1]}", "detail": f"{worst[0]} worst" + (f" · {haz} unhealthy" if haz else ""), "color": "#7dd87d"})
                else:
                    raise ValueError("no data")
            else:
                raise ValueError("no cache")
        except Exception:
            h.append({"tab": "airquality", "icon": "🌬", "label": "Air Quality", "value": "—", "detail": "loading", "color": "#7dd87d"})

        self._send_json(out)

    def _network(self):
        """Submarine-cable count from bundled cables.json.

        The original lab dashboard extended this with home-LAN + Unraid
        telemetry; those integrations have been stripped from the showcase
        build since they require private credentials and local endpoints.
        """
        try:
            with open("cables.json") as f:
                cables = json.load(f)
            self._send_json({
                "now": datetime.now(timezone.utc).isoformat(),
                "cable_count": len(cables),
            })
        except Exception as e:
            self._send_json({"error": str(e)}, status=502)

    def _volcanic(self):
        """Active volcanoes + natural hazards from NASA EONET."""
        now = datetime.now(timezone.utc)
        errors = []

        # Volcanoes — last 365 days
        volcanoes = []
        try:
            vdata = cached_fetch(
                "eonet:volcanoes",
                "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&limit=50&days=365",
                ttl=600.0,
                timeout=15.0,
            )
            for e in vdata.get("events", []):
                geo = e.get("geometry", [{}])
                latest = geo[-1] if geo else {}
                coords = latest.get("coordinates", [None, None])
                volcanoes.append({
                    "id": e.get("id"),
                    "title": e.get("title"),
                    "lon": coords[0],
                    "lat": coords[1],
                    "date": latest.get("date"),
                    "open": not bool(e.get("closed")),
                    "link": e.get("link"),
                    "sources": [s.get("url") for s in e.get("sources", [])],
                })
        except Exception as ex:
            errors.append(f"volcanoes: {ex}")

        # Open events — wildfires + storms (capped to avoid huge payloads)
        wildfires = []
        storms = []
        try:
            odata = cached_fetch(
                "eonet:open",
                "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300",
                ttl=600.0,
                timeout=15.0,
            )
            for e in odata.get("events", []):
                cats = [c["id"] for c in e.get("categories", [])]
                geo = e.get("geometry", [{}])
                latest = geo[-1] if geo else {}
                coords = latest.get("coordinates", [None, None])
                entry = {
                    "id": e.get("id"),
                    "title": e.get("title"),
                    "lon": coords[0],
                    "lat": coords[1],
                    "date": latest.get("date"),
                }
                if "wildfires" in cats:
                    wildfires.append(entry)
                elif "severeStorms" in cats:
                    storms.append(entry)
        except Exception as ex:
            errors.append(f"open events: {ex}")

        self._send_json({
            "now": now.isoformat(),
            "volcanoes": volcanoes,
            "wildfires": wildfires[:200],
            "storms": storms,
            "stats": {
                "active_volcanoes": sum(1 for v in volcanoes if v["open"]),
                "total_volcanoes_1yr": len(volcanoes),
                "wildfires": len(wildfires),
                "storms": len(storms),
                "total_events": len(volcanoes) + len(wildfires) + len(storms),
            },
            "errors": errors if errors else None,
        })

    def _population(self):
        """World population stats with live-counter seed data."""
        now = datetime.now(timezone.utc)

        # Base: World Bank 2023 data (SP.POP.TOTL = 8,064,057,930)
        base_date = datetime(2023, 7, 1, tzinfo=timezone.utc)  # mid-year estimate
        base_pop = 8_064_057_930
        birth_rate = 16.3358  # per 1000 per year
        death_rate = 7.5892   # per 1000 per year
        growth_rate = birth_rate - death_rate  # per 1000 per year

        # Extrapolate to now using continuous growth
        years_elapsed = (now - base_date).total_seconds() / (365.25 * 86400)
        current_pop = base_pop * (1 + growth_rate / 1000) ** years_elapsed

        # Per-second rates
        births_per_sec = current_pop * birth_rate / 1000 / (365.25 * 86400)
        deaths_per_sec = current_pop * death_rate / 1000 / (365.25 * 86400)
        growth_per_sec = births_per_sec - deaths_per_sec

        # Since midnight UTC
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        secs_today = (now - midnight).total_seconds()
        births_today = int(births_per_sec * secs_today)
        deaths_today = int(deaths_per_sec * secs_today)

        # Top countries with capitals for map
        top_countries = [
            {"name": "India",           "pop": 1_438_069_596, "iso": "IND", "lat": 28.61, "lon": 77.21},
            {"name": "China",           "pop": 1_410_710_000, "iso": "CHN", "lat": 39.90, "lon": 116.41},
            {"name": "United States",   "pop":   336_806_231, "iso": "USA", "lat": 38.90, "lon": -77.04},
            {"name": "Indonesia",       "pop":   281_190_067, "iso": "IDN", "lat": -6.20, "lon": 106.85},
            {"name": "Pakistan",        "pop":   247_504_495, "iso": "PAK", "lat": 33.69, "lon": 73.04},
            {"name": "Nigeria",         "pop":   227_882_945, "iso": "NGA", "lat":  9.06, "lon":  7.49},
            {"name": "Brazil",          "pop":   211_140_729, "iso": "BRA", "lat":-15.79, "lon":-47.88},
            {"name": "Bangladesh",      "pop":   171_466_990, "iso": "BGD", "lat": 23.81, "lon": 90.41},
            {"name": "Russia",          "pop":   143_826_130, "iso": "RUS", "lat": 55.76, "lon": 37.62},
            {"name": "Mexico",          "pop":   129_739_759, "iso": "MEX", "lat": 19.43, "lon":-99.13},
            {"name": "Ethiopia",        "pop":   128_691_692, "iso": "ETH", "lat":  9.03, "lon": 38.74},
            {"name": "Japan",           "pop":   124_516_650, "iso": "JPN", "lat": 35.69, "lon":139.69},
            {"name": "Philippines",     "pop":   114_891_199, "iso": "PHL", "lat": 14.60, "lon":120.98},
            {"name": "Egypt",           "pop":   114_535_772, "iso": "EGY", "lat": 30.04, "lon": 31.24},
            {"name": "DR Congo",        "pop":   105_789_731, "iso": "COD", "lat": -4.32, "lon": 15.31},
            {"name": "Vietnam",         "pop":   100_352_192, "iso": "VNM", "lat": 21.03, "lon":105.85},
            {"name": "Iran",            "pop":    90_608_707, "iso": "IRN", "lat": 35.69, "lon": 51.39},
            {"name": "Turkey",          "pop":    85_325_965, "iso": "TUR", "lat": 39.93, "lon": 32.87},
            {"name": "Germany",         "pop":    83_287_273, "iso": "DEU", "lat": 52.52, "lon": 13.41},
            {"name": "Thailand",        "pop":    71_702_435, "iso": "THA", "lat": 13.76, "lon":100.50},
            {"name": "UK",              "pop":    68_492_000, "iso": "GBR", "lat": 51.51, "lon": -0.13},
            {"name": "France",          "pop":    68_372_286, "iso": "FRA", "lat": 48.85, "lon":  2.35},
            {"name": "Tanzania",        "pop":    66_617_606, "iso": "TZA", "lat": -6.79, "lon": 39.28},
            {"name": "South Africa",    "pop":    63_212_384, "iso": "ZAF", "lat":-25.75, "lon": 28.19},
            {"name": "Italy",           "pop":    58_984_216, "iso": "ITA", "lat": 41.90, "lon": 12.50},
        ]

        # Continent breakdown (approximate 2023 figures from UN WPP)
        continents = [
            {"name": "Asia",          "pop": 4_770_000_000, "color": "#ffb347"},
            {"name": "Africa",        "pop": 1_460_000_000, "color": "#ff4d6d"},
            {"name": "Europe",        "pop":   745_000_000, "color": "#5fd1ff"},
            {"name": "Latin America", "pop":   660_000_000, "color": "#a0e84a"},
            {"name": "North America", "pop":   380_000_000, "color": "#ffd64a"},
            {"name": "Oceania",       "pop":    46_000_000, "color": "#a855f7"},
        ]

        self._send_json({
            "now": now.isoformat(),
            "world_pop": round(current_pop),
            "base_date": base_date.isoformat(),
            "base_pop": base_pop,
            "birth_rate_1k": round(birth_rate, 4),
            "death_rate_1k": round(death_rate, 4),
            "growth_rate_1k": round(growth_rate, 4),
            "growth_pct": round(growth_rate / 10, 3),
            "births_per_sec": round(births_per_sec, 3),
            "deaths_per_sec": round(deaths_per_sec, 3),
            "growth_per_sec": round(growth_per_sec, 3),
            "births_today": births_today,
            "deaths_today": deaths_today,
            "growth_today": births_today - deaths_today,
            "top_countries": top_countries,
            "continents": continents,
        })

    def _atmosphere(self):
        """Fetch current weather at curated world cities from Open-Meteo (no key)."""
        lats = ",".join(f"{c[1]}" for c in WORLD_CITIES)
        lons = ",".join(f"{c[2]}" for c in WORLD_CITIES)
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={lats}&longitude={lons}"
            "&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,"
            "relative_humidity_2m,surface_pressure,precipitation,is_day"
            "&timezone=UTC&forecast_days=1"
        )
        try:
            data = cached_fetch("atmos:cities", url, ttl=600.0, timeout=15.0)
        except Exception as e:
            return self._send_json({"error": str(e)}, status=502)

        if not isinstance(data, list):
            # Open-Meteo returns a list when multiple locations are queried,
            # but a single dict for 1 location. Normalise.
            data = [data]

        cities = []
        for i, entry in enumerate(data):
            if i >= len(WORLD_CITIES):
                break
            name, lat, lon, country = WORLD_CITIES[i]
            cur = entry.get("current", {}) if isinstance(entry, dict) else {}
            cities.append({
                "name": name,
                "country": country,
                "lat": lat,
                "lon": lon,
                "temp": cur.get("temperature_2m"),
                "wcode": cur.get("weather_code"),
                "wind": cur.get("wind_speed_10m"),
                "wind_dir": cur.get("wind_direction_10m"),
                "humidity": cur.get("relative_humidity_2m"),
                "pressure": cur.get("surface_pressure"),
                "precip": cur.get("precipitation"),
                "is_day": cur.get("is_day"),
            })

        temps = [c["temp"] for c in cities if c["temp"] is not None]
        winds = [c["wind"] for c in cities if c["wind"] is not None]
        pressures = [c["pressure"] for c in cities if c["pressure"] is not None]

        stats = {"city_count": len(cities)}
        if temps:
            hottest = max(cities, key=lambda c: (c["temp"] is not None, c["temp"] or -999))
            coldest = min(cities, key=lambda c: (c["temp"] is None, c["temp"] if c["temp"] is not None else 999))
            stats.update({
                "temp_min": min(temps),
                "temp_max": max(temps),
                "temp_avg": round(sum(temps) / len(temps), 1),
                "temp_range": round(max(temps) - min(temps), 1),
                "hottest": {"name": hottest["name"], "temp": hottest["temp"]},
                "coldest": {"name": coldest["name"], "temp": coldest["temp"]},
            })
        if winds:
            windiest = max(cities, key=lambda c: (c["wind"] is not None, c["wind"] or 0))
            stats.update({
                "wind_max": max(winds),
                "wind_avg": round(sum(winds) / len(winds), 1),
                "windiest": {"name": windiest["name"], "wind": windiest["wind"]},
            })
        if pressures:
            stats.update({
                "pressure_min": round(min(pressures), 1),
                "pressure_max": round(max(pressures), 1),
            })

        self._send_json({
            "now": datetime.now(timezone.utc).isoformat(),
            "cities": cities,
            "stats": stats,
        })

    def _solar(self):
        """Aggregate NOAA SWPC feeds into one payload."""
        out = {"now": datetime.now(timezone.utc).isoformat()}
        errors = []

        def try_fetch(key, url, ttl):
            try:
                return cached_fetch(key, url, ttl=ttl)
            except Exception as e:
                errors.append(f"{key}: {e}")
                return None

        # Kp index — 3-hourly, 7 days
        kp_rows = try_fetch(
            "swpc:kp",
            "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
            ttl=300,
        )
        if kp_rows:
            kp_series = []
            for row in kp_rows:
                try:
                    kp_series.append({
                        "t": row["time_tag"],
                        "kp": float(row["Kp"]),
                        "a": float(row.get("a_running") or 0),
                    })
                except Exception:
                    pass
            out["kp"] = {
                "current": kp_series[-1]["kp"] if kp_series else None,
                "series": kp_series,  # already chronological
                "max_7d": max((r["kp"] for r in kp_series), default=None),
            }

        # F10.7 (solar radio flux)
        f107 = try_fetch(
            "swpc:f107",
            "https://services.swpc.noaa.gov/products/summary/10cm-flux.json",
            ttl=3600,
        )
        if f107 and isinstance(f107, list) and f107:
            out["f107"] = {"flux": f107[0].get("flux"), "time": f107[0].get("time_tag")}

        # Solar wind plasma (2h): columns [time, density, speed, temperature]
        plasma = try_fetch(
            "swpc:plasma",
            "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json",
            ttl=60,
        )
        plasma_series = []
        if plasma and isinstance(plasma, list) and len(plasma) > 1:
            for row in plasma[1:]:
                try:
                    t, dens, spd, temp = row[0], row[1], row[2], row[3]
                    plasma_series.append({
                        "t": t,
                        "density": None if dens in (None, "") else float(dens),
                        "speed": None if spd in (None, "") else float(spd),
                        "temp": None if temp in (None, "") else float(temp),
                    })
                except Exception:
                    pass

        # IMF magnetic field (2h): [time, bx, by, bz, lon, lat, bt]
        mag = try_fetch(
            "swpc:mag",
            "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json",
            ttl=60,
        )
        mag_series = []
        if mag and isinstance(mag, list) and len(mag) > 1:
            for row in mag[1:]:
                try:
                    mag_series.append({
                        "t": row[0],
                        "bx": float(row[1]) if row[1] else None,
                        "by": float(row[2]) if row[2] else None,
                        "bz": float(row[3]) if row[3] else None,
                        "bt": float(row[6]) if row[6] else None,
                    })
                except Exception:
                    pass

        def last_valid(series, key):
            for row in reversed(series):
                if row.get(key) is not None:
                    return row[key]
            return None

        out["wind"] = {
            "speed": last_valid(plasma_series, "speed"),
            "density": last_valid(plasma_series, "density"),
            "temp": last_valid(plasma_series, "temp"),
            "bt": last_valid(mag_series, "bt"),
            "bz": last_valid(mag_series, "bz"),
            "plasma_series": plasma_series[-60:],  # last hour
            "mag_series": mag_series[-60:],
        }

        # GOES X-ray flux — we want the 0.1-0.8nm channel
        xrays = try_fetch(
            "swpc:xray",
            "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json",
            ttl=120,
        )
        if xrays:
            long_ch = [r for r in xrays if r.get("energy") == "0.1-0.8nm"]
            long_ch.sort(key=lambda r: r.get("time_tag", ""))
            # downsample to ~240 points for 24h
            step = max(1, len(long_ch) // 240)
            downsampled = []
            for i in range(0, len(long_ch), step):
                r = long_ch[i]
                downsampled.append({"t": r.get("time_tag"), "f": r.get("flux")})
            latest = long_ch[-1] if long_ch else None
            latest_flux = latest.get("flux") if latest else None
            out["xray"] = {
                "series": downsampled,
                "latest_flux": latest_flux,
                "latest_class": flux_to_class(latest_flux),
                "latest_time": latest.get("time_tag") if latest else None,
                "peak_24h": max((r.get("flux") or 0) for r in long_ch) if long_ch else None,
                "peak_class": flux_to_class(max((r.get("flux") or 0) for r in long_ch)) if long_ch else None,
            }

        # Alerts — latest 20
        alerts = try_fetch(
            "swpc:alerts",
            "https://services.swpc.noaa.gov/products/alerts.json",
            ttl=300,
        )
        if alerts:
            out["alerts"] = [
                {
                    "issued": a.get("issue_datetime"),
                    "product": a.get("product_id"),
                    "message": (a.get("message") or "").strip()[:800],
                }
                for a in alerts[:20]
            ]

        # Ovation aurora — filter cells with probability >= 5
        ov = try_fetch(
            "swpc:ovation",
            "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
            ttl=300,
        )
        if ov and "coordinates" in ov:
            cells = []
            max_prob = 0
            for lon, lat, p in ov["coordinates"]:
                if p and p >= 5:
                    cells.append([lon, lat, p])
                if p and p > max_prob:
                    max_prob = p
            out["aurora"] = {
                "obs_time": ov.get("Observation Time"),
                "forecast_time": ov.get("Forecast Time"),
                "max_prob": max_prob,
                "cells": cells,
            }

        if errors:
            out["partial_errors"] = errors
        self._send_json(out)

    def _orbital(self):
        now = datetime.now(timezone.utc)
        try:
            name, l1, l2 = get_tle(25544, "ISS (ZARYA)")
        except Exception as e:
            return self._send_json({"error": f"tle: {e}"}, status=502)
        sat = Satrec.twoline2rv(l1, l2)

        current = propagate(sat, now)
        if current is None:
            return self._send_json({"error": "sgp4 failed"}, status=500)
        lat, lon, alt, speed = current

        # Orbital period from TLE mean motion (line 2 field 8 = rev/day)
        try:
            mean_motion = float(l2[52:63])
            period_min = 1440.0 / mean_motion
        except Exception:
            period_min = 92.8

        # Forward ground track: one full orbit ahead at 30s steps
        track_fwd = []
        steps = int(period_min * 2)  # every 30s
        for i in range(steps + 1):
            t = now + timedelta(seconds=i * 30)
            p = propagate(sat, t)
            if p is not None:
                track_fwd.append([round(p[1], 3), round(p[0], 3)])  # [lon, lat]

        # Back track: previous half orbit, for context
        track_back = []
        for i in range(1, int(period_min) + 1):
            t = now - timedelta(seconds=i * 30)
            p = propagate(sat, t)
            if p is not None:
                track_back.append([round(p[1], 3), round(p[0], 3)])

        # ----- Tiangong (CSS) — full ground track like ISS -----
        tiangong_data = None
        try:
            tg_name, tg_l1, tg_l2 = get_tle(48274, "CSS (TIANHE)")
            tg_sat = Satrec.twoline2rv(tg_l1, tg_l2)
            tg_cur = propagate(tg_sat, now)
            if tg_cur:
                tg_lat, tg_lon, tg_alt, tg_speed = tg_cur
                try:
                    tg_mm = float(tg_l2[52:63])
                    tg_period = 1440.0 / tg_mm
                except Exception:
                    tg_period = 92.0
                tg_fwd = []
                for i in range(int(tg_period * 2) + 1):
                    t = now + timedelta(seconds=i * 30)
                    p = propagate(tg_sat, t)
                    if p: tg_fwd.append([round(p[1], 3), round(p[0], 3)])
                tg_back = []
                for i in range(1, int(tg_period) + 1):
                    t = now - timedelta(seconds=i * 30)
                    p = propagate(tg_sat, t)
                    if p: tg_back.append([round(p[1], 3), round(p[0], 3)])
                tiangong_data = {
                    "lat": round(tg_lat, 4), "lon": round(tg_lon, 4),
                    "alt_km": round(tg_alt, 2), "speed_km_h": round(tg_speed * 3600, 0),
                    "period_min": round(tg_period, 2),
                    "track_forward": tg_fwd, "track_back": tg_back,
                }
        except Exception:
            pass  # non-fatal

        # ----- Bright/famous satellites — position only -----
        satellites = []
        for norad, disp_name, category in TRACKED_SATS:
            if norad == 48274:
                continue  # already handled as Tiangong
            try:
                s_name, s_l1, s_l2 = get_tle(norad, disp_name)
                s_sat = Satrec.twoline2rv(s_l1, s_l2)
                s_cur = propagate(s_sat, now)
                if s_cur:
                    s_lat, s_lon, s_alt, s_speed = s_cur
                    try:
                        s_mm = float(s_l2[52:63])
                        s_period = 1440.0 / s_mm
                    except Exception:
                        s_period = 0
                    satellites.append({
                        "norad": norad, "name": disp_name, "category": category,
                        "lat": round(s_lat, 4), "lon": round(s_lon, 4),
                        "alt_km": round(s_alt, 2), "speed_km_h": round(s_speed * 3600, 0),
                        "period_min": round(s_period, 2),
                    })
            except Exception:
                pass  # skip failed satellites

        # People in space
        people = []
        try:
            astros = cached_fetch("astros", "http://api.open-notify.org/astros.json", ttl=600.0)
            for p in astros.get("people", []):
                people.append({"name": p.get("name"), "craft": p.get("craft")})
        except Exception:
            pass  # non-fatal

        sub_lat, sub_lon = sun_subsolar(now)

        self._send_json({
            "tle": {"name": name, "line1": l1, "line2": l2},
            "now": now.isoformat(),
            "iss": {
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "alt_km": round(alt, 2),
                "speed_km_s": round(speed, 3),
                "speed_km_h": round(speed * 3600, 0),
                "period_min": round(period_min, 2),
                "orbits_per_day": round(24 * 60 / period_min, 2),
            },
            "track_forward": track_fwd,
            "track_back": track_back,
            "tiangong": tiangong_data,
            "satellites": satellites,
            "sun": {"lat": round(sub_lat, 3), "lon": round(sub_lon, 3)},
            "people": people,
            "people_count": len(people),
            "moon": self._moon_phase(now),
        })

    @staticmethod
    def _moon_phase(now):
        ref = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
        days_since = (now - ref).total_seconds() / 86400
        synodic = 29.53059
        phase = (days_since % synodic) / synodic
        illum = (1 - math.cos(phase * 2 * math.pi)) / 2 * 100
        names = [
            (0.0625, "New Moon"), (0.1875, "Waxing Crescent"),
            (0.3125, "First Quarter"), (0.4375, "Waxing Gibbous"),
            (0.5625, "Full Moon"), (0.6875, "Waning Gibbous"),
            (0.8125, "Last Quarter"), (0.9375, "Waning Crescent"),
            (1.0001, "New Moon"),
        ]
        name = "New Moon"
        for threshold, n in names:
            if phase < threshold:
                name = n
                break
        emojis = "🌑🌒🌓🌔🌕🌖🌗🌘"
        emoji = emojis[int(phase * 8) % 8]
        return {
            "phase": round(phase, 4),
            "illumination": round(illum, 1),
            "name": name,
            "emoji": emoji,
            "days_to_full": round(((0.5 - phase) % 1) * synodic, 1),
            "days_to_new": round(((1.0 - phase) % 1) * synodic, 1),
        }

    def _seismic(self):
        # Period param: hour, day, week, month. Default day.
        period = "day"
        if "?" in self.path:
            q = self.path.split("?", 1)[1]
            for part in q.split("&"):
                if part.startswith("period="):
                    v = part.split("=", 1)[1]
                    if v in ("hour", "day", "week", "month"):
                        period = v
        url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_{period}.geojson"
        try:
            data = cached_fetch(f"seismic:{period}", url, ttl=60.0)
        except Exception as e:
            return self._send_json({"error": str(e)}, status=502)

        features = data.get("features", [])
        quakes = []
        mags = []
        for f in features:
            p = f.get("properties", {}) or {}
            g = f.get("geometry", {}) or {}
            coords = g.get("coordinates") or [None, None, None]
            mag = p.get("mag")
            if mag is None:
                continue
            mags.append(mag)
            quakes.append({
                "id": f.get("id"),
                "mag": mag,
                "place": p.get("place"),
                "time": p.get("time"),
                "updated": p.get("updated"),
                "tsunami": p.get("tsunami", 0),
                "felt": p.get("felt"),
                "sig": p.get("sig"),
                "type": p.get("type"),
                "url": p.get("url"),
                "lon": coords[0],
                "lat": coords[1],
                "depth": coords[2],
            })
        quakes.sort(key=lambda q: q["time"] or 0, reverse=True)

        stats = {
            "count": len(quakes),
            "max_mag": max(mags) if mags else None,
            "avg_mag": round(sum(mags) / len(mags), 2) if mags else None,
            "felt_reports": sum((q["felt"] or 0) for q in quakes),
            "tsunami_alerts": sum(1 for q in quakes if q["tsunami"]),
            "m5plus": sum(1 for q in quakes if (q["mag"] or 0) >= 5),
            "m4plus": sum(1 for q in quakes if (q["mag"] or 0) >= 4),
            "m2plus": sum(1 for q in quakes if (q["mag"] or 0) >= 2),
        }
        self._send_json({
            "period": period,
            "generated": data.get("metadata", {}).get("generated"),
            "stats": stats,
            "quakes": quakes,
        })


if __name__ == "__main__":
    print(f"World Command Centre on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
