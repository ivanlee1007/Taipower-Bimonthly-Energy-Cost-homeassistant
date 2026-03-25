"""Constants for TaiPower Bimonthly Energy Cost Integration."""
from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntityDescription,
    SensorStateClass,
)

CONFIG_FLOW_VERSION = 2

DOMAIN = "taipower_bimonthly_cost"
PLATFORMS = ["sensor"]

ATTR_BIMONTHLY_ENERGY = "bimonthly energy source"
ATTR_KWH_COST = "price per kwh"
ATTR_START_DAY = "start day"
ATTR_USED_DAYS = "used days"
ATTR_BILLING_MODE = "billing_mode"
ATTR_PDF_VERSION = "pdf_version"
UNIT_KWH_COST = "TWD/kWh"
UNIT_TWD = "TWD"
CONF_BIMONTHLY_ENERGY = "bimonthly_energy"
CONF_METER_START_DAY = "meter_start_day"
CONF_BILLING_MODE = "billing_mode"

# ── Billing Modes ────────────────────────────────────────────────────────────
# Tier thresholds are cumulative kWh boundaries.
# Each tier: {"threshold": <upper_limit>, "rate_summer": <rate>, "rate_non_summer": <rate>}
# The last tier has no upper limit (threshold = None means "above previous").

BILLING_MODES = {
    "residential": {
        "name": "住宅用",
        "pdf_url": "https://www.taipower.com.tw/media/ba2angqi/各類電價表及計算範例.pdf",
        "pdf_version": "11410",
        "tiers": [
            {"threshold": 120,   "rate_summer": 1.78, "rate_non_summer": 1.78},
            {"threshold": 330,   "rate_summer": 2.55, "rate_non_summer": 2.26},
            {"threshold": 500,   "rate_summer": 3.80, "rate_non_summer": 3.13},
            {"threshold": 700,   "rate_summer": 5.14, "rate_non_summer": 4.24},
            {"threshold": 1000,  "rate_summer": 6.44, "rate_non_summer": 5.27},
            {"threshold": None,  "rate_summer": 8.86, "rate_non_summer": 7.03},
        ],
    },
    "non_commercial": {
        "name": "非營業用",
        "pdf_url": "https://www.taipower.com.tw/media/ba2angqi/各類電價表及計算範例.pdf",
        "pdf_version": "11410",
        "tiers": [
            {"threshold": 120,   "rate_summer": 1.78, "rate_non_summer": 1.78},
            {"threshold": 330,   "rate_summer": 2.55, "rate_non_summer": 2.26},
            {"threshold": 500,   "rate_summer": 3.80, "rate_non_summer": 3.13},
            {"threshold": 700,   "rate_summer": 5.14, "rate_non_summer": 4.24},
            {"threshold": 1000,  "rate_summer": 6.44, "rate_non_summer": 5.27},
            {"threshold": None,  "rate_summer": 8.86, "rate_non_summer": 7.03},
        ],
    },
    "commercial": {
        "name": "營業用",
        "pdf_url": "https://www.taipower.com.tw/media/ba2angqi/各類電價表及計算範例.pdf",
        "pdf_version": "11410",
        "tiers": [
            {"threshold": 330,   "rate_summer": 2.71, "rate_non_summer": 2.28},
            {"threshold": 700,   "rate_summer": 3.76, "rate_non_summer": 3.10},
            {"threshold": 1500,  "rate_summer": 4.46, "rate_non_summer": 3.61},
            {"threshold": 3000,  "rate_summer": 7.08, "rate_non_summer": 5.56},
            {"threshold": None,  "rate_summer": 7.43, "rate_non_summer": 5.83},
        ],
    },
}

DEFAULT_BILLING_MODE = "residential"


# ── Cost Calculation ─────────────────────────────────────────────────────────

def calculate_cost(kwh: float, mode: str, is_summer: bool) -> tuple:
    """Calculate the cost and average kWh cost from cumulative kWh usage.

    Uses progressive (累進) tiered pricing:
      - For each tier, the rate applies only to the kWh within that tier.
      - The *average* kWh cost (self._kwh_cost) is total_cost / total_kwh.

    Returns:
        (total_cost, avg_kwh_cost)  or  (None, None) if kwh < 0 or mode not found.
    """
    if kwh < 0 or mode not in BILLING_MODES:
        return None, None

    tiers = BILLING_MODES[mode]["tiers"]
    rate_key = "rate_summer" if is_summer else "rate_non_summer"

    total_cost = 0.0
    remaining = kwh
    prev_threshold = 0

    for tier in tiers:
        upper = tier["threshold"]
        if upper is not None:
            tier_usage = min(remaining, upper - prev_threshold)
        else:
            tier_usage = remaining  # last/open tier

        if tier_usage <= 0:
            prev_threshold = upper if upper is not None else prev_threshold
            continue

        total_cost += tier_usage * tier[rate_key]
        remaining -= tier_usage
        prev_threshold = upper if upper is not None else prev_threshold

        if remaining <= 0:
            break

    avg_kwh_cost = total_cost / kwh if kwh > 0 else None
    return total_cost, avg_kwh_cost


# ── Sensor Descriptions ─────────────────────────────────────────────────────

@dataclass
class TaiPowerCostSensorDescription(
    SensorEntityDescription
):
    """Class to describe an TaiPower Energy Cost sensor."""


COST_SENSORS: tuple[TaiPowerCostSensorDescription, ...] = (
    TaiPowerCostSensorDescription(
        key="kwh_cost",
        name="Price Per kWh",
        native_unit_of_measurement=UNIT_KWH_COST,
        device_class=SensorDeviceClass.MONETARY,
        #state_class=SensorStateClass.MEASUREMENT,
        #Try to workaround HA 2023.2.1 sensor class warning issue
    ),
    TaiPowerCostSensorDescription(
        key="power_cost",
        name="Power Cost",
        native_unit_of_measurement=UNIT_TWD,
        device_class=SensorDeviceClass.MONETARY,
        #state_class=SensorStateClass.MEASUREMENT,
        #Try to workaround HA 2023.2.1 sensor class warning issue
    )
)
