"""Support for TaiPower Energy Cost service."""
import logging
from datetime import datetime

from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.helpers.typing import ConfigType

from .const import (
    ATTR_BIMONTHLY_ENERGY,
    ATTR_KWH_COST,
    ATTR_START_DAY,
    ATTR_USED_DAYS,
    ATTR_BILLING_MODE,
    ATTR_PDF_VERSION,
    CONF_BIMONTHLY_ENERGY,
    CONF_METER_START_DAY,
    CONF_BILLING_MODE,
    DOMAIN,
    UNIT_KWH_COST,
    COST_SENSORS,
    DEFAULT_BILLING_MODE,
    BILLING_MODES,
    TaiPowerCostSensorDescription,
    calculate_cost,
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
                    [KwhCostSensor(hass, entry.options, description)]
                )
            if description.key == "power_cost":
                entities.extend(
                    [EnergyCostSensor(hass, entry.options, description)]
                )

        async_add_entities(entities)
    except AttributeError as ex:
        _LOGGER.error(ex)

class CostSensor(SensorEntity):
    """Implementation of a energy cost sensor."""
    entity_description: TaiPowerCostSensorDescription

    def __init__(self, hass, entry_data, description):
        self.entity_description = description
        self._hass = hass
        self._energy_entity = entry_data[CONF_BIMONTHLY_ENERGY]
        self._kwh_cost = None
        self._billing_mode = entry_data.get(CONF_BILLING_MODE, DEFAULT_BILLING_MODE)

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
            if state == "unknown":
                return None
            if isinstance(state, (float, int, str)):
                is_summer = now.month in [6, 7, 8, 9]
                _, avg_cost = calculate_cost(float(state), self._billing_mode, is_summer)
                self._kwh_cost = avg_cost
        return self._kwh_cost


class EnergyCostSensor(KwhCostSensor):
    """Implementation of a energy cost sensor."""
    def __init__(self, hass, entry_data, description):
        super().__init__(hass, entry_data, description)
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
            if state == "unknown":
                return None
            if isinstance(state, (float, int, str)):
                is_summer = now.month in [6, 7, 8, 9]
                total_cost, avg_cost = calculate_cost(float(state), self._billing_mode, is_summer)
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
