"""Support for TaiPower Energy Cost service."""
import logging
from datetime import datetime

from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers.device_registry import DeviceInfo

from .const import (
    ATTR_BIMONTHLY_ENERGY,
    ATTR_KWH_COST,
    ATTR_START_DAY,
    ATTR_USED_DAYS,
    ATTR_BILLING_MODE,
    ATTR_PDF_VERSION,
    ATTR_RATES_VERSION,
    ATTR_LAST_UPDATED,
    ATTR_LAST_PARSED_AT,
    ATTR_RATES_AGE_DAYS,
    CONF_BIMONTHLY_ENERGY,
    CONF_METER_START_DAY,
    CONF_BILLING_MODE,
    CONF_MANUAL_RATES,
    DOMAIN,
    UNIT_KWH_COST,
    COST_SENSORS,
    DEFAULT_BILLING_MODE,
    BILLING_MODES,
    TaiPowerCostSensorDescription,
    calculate_cost,
    get_effective_tiers,
    validate_rates,
    load_rates_info,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigType, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the energy cost sensor."""

    try:
        entities = []
        for description in COST_SENSORS:
            if description.key == "kwh_cost":
                entities.extend(
                    [KwhCostSensor(hass, entry.options, description, entry.entry_id)]
                )
            if description.key == "power_cost":
                entities.extend(
                    [EnergyCostSensor(hass, entry.options, description, entry.entry_id)]
                )
            if description.key == "rate_status":
                # Merge data + options so RateStatusSensor can see manual_rates
                merged = {**entry.data, **entry.options}
                entities.extend(
                    [RateStatusSensor(hass, merged, description, entry.entry_id)]
                )

        async_add_entities(entities)
    except AttributeError as ex:
        _LOGGER.error(ex)


class CostSensor(SensorEntity):
    """Implementation of a energy cost sensor."""
    entity_description: TaiPowerCostSensorDescription
    entity_registry_enabled_default = True

    def __init__(self, hass, entry_data, description, entry_id=None):
        self.entity_description = description
        self._hass = hass
        self._energy_entity = entry_data[CONF_BIMONTHLY_ENERGY]
        self._kwh_cost = None
        self._billing_mode = entry_data.get(CONF_BILLING_MODE, DEFAULT_BILLING_MODE)
        self._entry_data = entry_data  # keep for manual rates lookup
        self._entry_id = entry_id

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name="台電雙月電費",
            manufacturer="UNiNUS",
            model="TaiPower Cost Calculator",
        )

    @property
    def name(self):
        """Return the name of the sensor."""
        return "{}-{}".format(self._energy_entity, self.entity_description.key)

    @property
    def unique_id(self):
        """Return the unique of the sensor."""
        return "{}-{}".format(self._energy_entity, self.entity_description.key)

    def friendly_name(self):
        """Return the friendly name of the sensor."""
        return "{}".format(self.entity_description.name)

    @property
    def unit_of_measurement(self):
        """Return the unit of measurement."""
        return self.entity_description.native_unit_of_measurement

    @property
    def device_class(self):
        """Return the device class of the sensor."""
        return self.entity_description.device_class


class KwhCostSensor(CostSensor):
    """Implementation of a energy cost sensor."""

    @property
    def native_value(self):
        """Return the state of the sensor."""
        now = datetime.now()

        if self._hass.states.get(self._energy_entity):
            state = self._hass.states.get(self._energy_entity).state
            if state in ("unknown", "unavailable"):
                return None
            if isinstance(state, (float, int, str)):
                is_summer = now.month in [6, 7, 8, 9]
                tiers = get_effective_tiers(self._entry_data, self._billing_mode)
                _, avg_cost = calculate_cost(float(state), self._billing_mode, is_summer, tiers)
                self._kwh_cost = avg_cost
        return self._kwh_cost


class EnergyCostSensor(KwhCostSensor):
    """Implementation of a energy cost sensor."""
    def __init__(self, hass, entry_data, description, entry_id=None):
        super().__init__(hass, entry_data, description, entry_id)
        self._reset_day = entry_data[CONF_METER_START_DAY]

    async def reset_utility_meter(self, sensor):
        """Send a command."""
        service_data = {
            'value': '0.000',
            ATTR_ENTITY_ID: sensor
        }

        await self._hass.services.async_call(
            'utility_meter', 'calibrate', service_data)

    @property
    def native_value(self):
        """Return the state of the sensor."""
        now = datetime.now()
        value = None

        if self._hass.states.get(self._energy_entity):
            state = self._hass.states.get(self._energy_entity).state
            if state in ("unknown", "unavailable"):
                return None
            if isinstance(state, (float, int, str)):
                is_summer = now.month in [6, 7, 8, 9]
                tiers = get_effective_tiers(self._entry_data, self._billing_mode)
                total_cost, avg_cost = calculate_cost(float(state), self._billing_mode, is_summer, tiers)
                self._kwh_cost = avg_cost
                value = total_cost
        if ((now - self._reset_day).days % 60) == 59:
            if now.hour == 23 and now.minute == 59 and 0 < now.second <= 59:
                if (self._hass.states.get(self._energy_entity) and
                        self._hass.states.get(self._energy_entity).state != "unknown"):
                    self.reset_utility_meter(self._energy_entity)
        return value

    @property
    def extra_state_attributes(self):
        """Return the state attributes of the device."""
        now = datetime.now()
        mode_info = BILLING_MODES.get(self._billing_mode, {})
        return {
            ATTR_BIMONTHLY_ENERGY: self._energy_entity,
            ATTR_KWH_COST: "{} {}".format(self._kwh_cost, UNIT_KWH_COST),
            ATTR_START_DAY: self._reset_day,
            ATTR_USED_DAYS: (now - self._reset_day).days % 60,
            ATTR_BILLING_MODE: self._billing_mode,
            ATTR_PDF_VERSION: mode_info.get("pdf_version", "unknown"),
        }

    async def async_added_to_hass(self):
        """ added to hass """
        # convert to datetime format
        try:
            self._reset_day = datetime.strptime(self._reset_day, "%Y-%m-%d")
        except Exception:
            self._reset_day = datetime.strptime(self._reset_day, "%Y/%m/%d")


class RateStatusSensor(SensorEntity):
    """Sensor that shows whether the embedded electricity rates are current.

    States
    ------
    up_to_date    – rates_info.json exists, checksums match, data < 6 months
    rates_changed – checksum mismatch (PDF format may have changed)
    outdated      – data older than 6 months (PDF may have a newer version)
    no_info       – rates_info.json missing (first install / local dev)
    """

    entity_description: TaiPowerCostSensorDescription
    entity_registry_enabled_default = True

    _attr_icon = "mdi:cash-check"

    STATUS_LABELS = {
        "up_to_date": "✅ 最新",
        "rates_changed": "⚠️ 費率解析異常",
        "outdated": "⚠️ 費率可能過期",
        "no_info": "ℹ️ 尚未驗證",
    }

    def __init__(self, hass, entry_data, description, entry_id=None):
        self.entity_description = description
        self._hass = hass
        self._billing_mode = entry_data.get(CONF_BILLING_MODE, DEFAULT_BILLING_MODE)
        self._energy_entity = entry_data.get(CONF_BIMONTHLY_ENERGY, "")
        self._entry_data = entry_data  # for manual override detection
        self._entry_id = entry_id
        self._status = "no_info"
        self._details = {"_entry_data": entry_data}

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name="台電雙月電費",
            manufacturer="UNiNUS",
            model="TaiPower Cost Calculator",
        )

    @property
    def name(self):
        return "{}-{}".format(self._energy_entity, self.entity_description.key)

    @property
    def unique_id(self):
        return "{}-{}".format(self._energy_entity, self.entity_description.key)

    @property
    def native_value(self):
        return self.STATUS_LABELS.get(self._status, self._status)

    @property
    def extra_state_attributes(self):
        # Check if manual rates override is active for current billing mode
        manual = self._details.get("_entry_data", {}).get(CONF_MANUAL_RATES, {})
        manual_override = self._billing_mode in manual and bool(manual[self._billing_mode])

        attrs = {
            ATTR_RATES_VERSION: self._details.get("rates_version", "unknown"),
            ATTR_LAST_UPDATED: self._details.get("last_updated", "unknown"),
            ATTR_LAST_PARSED_AT: self._details.get("last_updated", "unknown"),
            ATTR_RATES_AGE_DAYS: self._details.get("age_days"),
            ATTR_PDF_VERSION: self._details.get("pdf_version", "unknown"),
            "pdf_url": self._details.get("pdf_url", ""),
            "billing_mode": self._billing_mode,
            "status_code": self._status,
            "manual_override": manual_override,
        }
        if "mismatches" in self._details:
            attrs["mismatches"] = self._details["mismatches"]
        return attrs

    async def async_added_to_hass(self):
        """Validate rates on startup."""
        self._status, self._details = await self._hass.async_add_executor_job(
            validate_rates
        )
        if self._status != "up_to_date":
            _LOGGER.warning(
                "TaiPower rates validation: %s – %s",
                self._status,
                self._details,
            )
