"""Support for TaiPower Energy Cost service."""
import logging
from datetime import datetime

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_state_change_event

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


def _get_config_value(config_entry, key, default):
    """Get config value from options first, then data.
    
    If options has the key but it's an empty string, fall back to data.
    """
    options_val = config_entry.options.get(key) if config_entry.options else None
    data_val = config_entry.data.get(key) if config_entry.data else None
    if options_val not in (None, ""):
        return options_val
    if data_val not in (None, ""):
        return data_val
    return default


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigType, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the energy cost sensor."""

    try:
        _LOGGER.info("TaiPower sensor setup: entry_id=%s", entry.entry_id)
        _LOGGER.info("TaiPower sensor setup: options=%s", dict(entry.options) if entry.options else None)
        _LOGGER.info("TaiPower sensor setup: data=%s", dict(entry.data) if entry.data else None)

        entities = []
        # Check required config exists
        energy_entity = _get_config_value(entry, CONF_BIMONTHLY_ENERGY, "")
        _LOGGER.info("TaiPower sensor setup: energy_entity=%r", energy_entity)
        if not energy_entity:
            _LOGGER.warning(
                "TaiPower: missing 'bimonthly_energy' config. "
                "Skipping sensor setup. Please configure via Integration -> Options."
            )
            return

        meter_start_day = _get_config_value(entry, CONF_METER_START_DAY, "")
        _LOGGER.info("TaiPower sensor setup: meter_start_day=%r", meter_start_day)
        if not meter_start_day:
            _LOGGER.warning(
                "TaiPower: missing 'meter_start_day' config. "
                "Skipping sensor setup. Please configure via Integration -> Options."
            )
            return

        # ── Clean up stale entities from this config entry ──
        # When energy entity changes, unique_ids change and old sensors become
        # orphaned (unavailable/restored). Remove them so only current ones exist.
        registry = er.async_get(hass)
        current_ids = {
            f"{energy_entity}-{desc.key}" for desc in COST_SENSORS
        }
        for entity_entry in list(registry.entities.values()):
            if (
                entity_entry.config_entry_id == entry.entry_id
                and entity_entry.platform == DOMAIN
                and entity_entry.unique_id not in current_ids
            ):
                _LOGGER.info(
                    "TaiPower: removing stale sensor %s (unique_id=%s)",
                    entity_entry.entity_id,
                    entity_entry.unique_id,
                )
                registry.async_remove(entity_entry.entity_id)

        merged = {**entry.data, **entry.options}
        for description in COST_SENSORS:
            if description.key == "kwh_cost":
                entities.extend(
                    [KwhCostSensor(hass, merged, description, entry.entry_id)]
                )
            if description.key == "power_cost":
                entities.extend(
                    [EnergyCostSensor(hass, merged, description, entry.entry_id)]
                )
            if description.key == "rate_status":
                entities.extend(
                    [RateStatusSensor(hass, merged, description, entry.entry_id)]
                )

        _LOGGER.info("TaiPower sensor setup: creating %d entities", len(entities))
        async_add_entities(entities)
    except Exception as ex:
        _LOGGER.error("TaiPower sensor setup error: %s", ex, exc_info=True)


class CostSensor(SensorEntity):
    """Implementation of a energy cost sensor."""
    entity_description: TaiPowerCostSensorDescription
    entity_registry_enabled_default = True

    def __init__(self, hass, entry_data, description, entry_id=None):
        self.entity_description = description
        self._hass = hass
        self._energy_entity = entry_data.get(CONF_BIMONTHLY_ENERGY)
        if not self._energy_entity:
            _LOGGER.warning(
                "Missing required config 'bimonthly_energy' - sensor '%s' will not function. "
                "Please reconfigure via Integration -> Options.",
                description.key,
            )
        self._kwh_cost = None
        self._billing_mode = entry_data.get(CONF_BILLING_MODE, DEFAULT_BILLING_MODE)
        self._entry_data = entry_data  # keep for manual rates lookup
        self._entry_id = entry_id
        self._unsub_source = None
        self._startup_refresh_unsubs = []

    async def async_added_to_hass(self):
        """Subscribe to source entity changes so restored sensors recover automatically."""
        await super().async_added_to_hass()

        if self._energy_entity:
            @callback
            def _handle_source_change(event):
                self.async_write_ha_state()

            self._unsub_source = async_track_state_change_event(
                self._hass,
                [self._energy_entity],
                _handle_source_change,
            )
            self.async_on_remove(self._unsub_source)

        # Immediate refresh plus a few delayed retries to survive HA startup
        # race conditions (source sensor may come back after this entity).
        self.async_write_ha_state()

        @callback
        def _delayed_refresh(_now):
            self.async_write_ha_state()

        for delay in (5, 15, 30):
            unsub = async_call_later(self._hass, delay, _delayed_refresh)
            self._startup_refresh_unsubs.append(unsub)
            self.async_on_remove(unsub)

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
                _, tier_rate = calculate_cost(float(state), self._billing_mode, is_summer, tiers)
                self._kwh_cost = tier_rate
        return self._kwh_cost


class EnergyCostSensor(KwhCostSensor):
    """Implementation of a energy cost sensor."""
    def __init__(self, hass, entry_data, description, entry_id=None):
        super().__init__(hass, entry_data, description, entry_id)
        self._reset_day = entry_data.get(CONF_METER_START_DAY)
        if not self._reset_day:
            _LOGGER.warning(
                "Missing required config 'meter_start_day' - power_cost sensor will not function. "
                "Please reconfigure via Integration -> Options."
            )

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
                total_cost, tier_rate = calculate_cost(float(state), self._billing_mode, is_summer, tiers)
                self._kwh_cost = tier_rate
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
            CONF_MANUAL_RATES: self._entry_data.get(CONF_MANUAL_RATES),
        }

    async def async_added_to_hass(self):
        """ added to hass """
        # convert to datetime format before base class triggers first recompute
        try:
            self._reset_day = datetime.strptime(self._reset_day, "%Y-%m-%d")
        except Exception:
            self._reset_day = datetime.strptime(self._reset_day, "%Y/%m/%d")
        await super().async_added_to_hass()


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
        self._start_day = entry_data.get(CONF_METER_START_DAY, "")
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
        manual = self._details.get("_entry_data", {}).get(CONF_MANUAL_RATES) or {}
        manual_override = self._billing_mode in manual and bool(manual[self._billing_mode])

        attrs = {
            ATTR_RATES_VERSION: self._details.get("rates_version", "unknown"),
            ATTR_LAST_UPDATED: self._details.get("last_updated", "unknown"),
            ATTR_LAST_PARSED_AT: self._details.get("last_updated", "unknown"),
            ATTR_RATES_AGE_DAYS: self._details.get("age_days"),
            ATTR_PDF_VERSION: self._details.get("pdf_version", "unknown"),
            "pdf_url": self._details.get("pdf_url", ""),
            ATTR_BIMONTHLY_ENERGY: self._energy_entity,
            ATTR_START_DAY: self._start_day,
            "billing_mode": self._billing_mode,
            CONF_MANUAL_RATES: manual,
            "status_code": self._status,
            "manual_override": manual_override,
        }
        if "mismatches" in self._details:
            attrs["mismatches"] = self._details["mismatches"]
        return attrs

    async def async_added_to_hass(self):
        """Validate rates on startup."""
        self._status, details = await self._hass.async_add_executor_job(
            validate_rates
        )
        self._details = {"_entry_data": self._entry_data, **(details or {})}
        if self._status != "up_to_date":
            _LOGGER.warning(
                "TaiPower rates validation: %s – %s",
                self._status,
                self._details,
            )
