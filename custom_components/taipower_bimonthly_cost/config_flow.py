"""Config flow for TaiPower Energy Cost integration."""
import json
import logging
from datetime import datetime

import voluptuous as vol

from homeassistant import config_entries, core
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONFIG_FLOW_VERSION,
    CONF_BIMONTHLY_ENERGY,
    CONF_METER_START_DAY,
    CONF_BILLING_MODE,
    CONF_MANUAL_RATES,
    DOMAIN,
    BILLING_MODES,
    DEFAULT_BILLING_MODE,
)

_LOGGER = logging.getLogger(__name__)


async def validate_input(hass: core.HomeAssistant, data):
    """Validate that the user input allows us to set up the integration."""
    energy_entity = data[CONF_BIMONTHLY_ENERGY]
    state = hass.states.get(energy_entity)
    if state is None:
        # Entity doesn't exist yet - warn but allow setup
        _LOGGER.warning("Entity %s not found, allowing setup anyway", energy_entity)

    return True


class TaiPowerCostFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for TaiPower Energy Cost."""

    VERSION = CONFIG_FLOW_VERSION

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}

        if user_input is not None:
            try:
                await validate_input(self.hass, user_input)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"
            else:
                title = "TaiPower Energy Cost"
                return self.async_create_entry(title=title, data=user_input)

        data_schema = vol.Schema(
            {
                vol.Required(CONF_BIMONTHLY_ENERGY): selector.selector(
                    {"entity": {"domain": "sensor"}},
                ),
                vol.Required(
                    CONF_METER_START_DAY,
                    default=datetime.now().strftime("%Y-%m-%d"),
                ): selector.selector({"date": {}}),
                vol.Required(
                    CONF_BILLING_MODE,
                    default=DEFAULT_BILLING_MODE,
                ): selector.selector(
                    {
                        "select": {
                            "options": [
                                {"value": k, "label": v["name"]}
                                for k, v in BILLING_MODES.items()
                            ]
                        }
                    },
                ),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Get the options flow."""
        return TaiPowerCostOptionsFlow(config_entry)


class TaiPowerCostOptionsFlow(config_entries.OptionsFlow):
    """Handle options for TaiPower Energy Cost."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize options flow."""
        self._config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        errors = {}

        if user_input is not None:
            try:
                # Validate entity exists (but allow if not)
                energy_entity = user_input.get(CONF_BIMONTHLY_ENERGY, "")
                state = self.hass.states.get(energy_entity)
                if state is None:
                    _LOGGER.warning("Entity %s not found, allowing anyway", energy_entity)

                # Validate and parse manual rates JSON
                manual_rates = {}
                manual_rates_str = user_input.get(CONF_MANUAL_RATES, "").strip()
                if manual_rates_str:
                    try:
                        parsed = json.loads(manual_rates_str)
                        # Validate structure
                        if not isinstance(parsed, dict):
                            raise ValueError("manual_rates must be a JSON object")
                        for mode, rates in parsed.items():
                            if mode not in BILLING_MODES:
                                raise ValueError(f"Unknown billing mode: {mode}")
                            if not isinstance(rates, dict):
                                raise ValueError(f"Rates for {mode} must be an object with 'summer' and 'non_summer' arrays")
                            summer = rates.get("summer", [])
                            non_summer = rates.get("non_summer", [])
                            if not isinstance(summer, list) or not isinstance(non_summer, list):
                                raise ValueError(f"summer and non_summer must be arrays")
                            if len(summer) != len(non_summer):
                                raise ValueError(f"summer and non_summer must have same length")
                            if len(summer) < 1:
                                raise ValueError(f"Rates must have at least 1 tier")
                            # Validate all are numbers
                            for i, (s, ns) in enumerate(zip(summer, non_summer)):
                                try:
                                    float(s)
                                    float(ns)
                                except (ValueError, TypeError):
                                    raise ValueError(f"Tier {i+1} rates must be numbers")
                        manual_rates = parsed
                    except json.JSONDecodeError as e:
                        raise ValueError(f"Invalid JSON: {e}")

                # Build new options from user input
                new_options = {
                    CONF_BIMONTHLY_ENERGY: energy_entity,
                    CONF_BILLING_MODE: user_input.get(CONF_BILLING_MODE, DEFAULT_BILLING_MODE),
                    CONF_METER_START_DAY: user_input.get(CONF_METER_START_DAY, ""),
                }
                if manual_rates:
                    new_options[CONF_MANUAL_RATES] = manual_rates

                self.hass.config_entries.async_update_entry(
                    self._config_entry, options=new_options,
                )
                return self.async_create_entry(title="", data={})
            except ValueError as e:
                errors[CONF_MANUAL_RATES] = str(e)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected exception in options flow")
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="init",
            data_schema=self._get_options_schema(),
            errors=errors,
        )

    def _get_options_schema(self):
        """Build options schema with current values as defaults."""
        # Get current manual rates as JSON string for textarea
        manual_rates = _get_config_value(self._config_entry, CONF_MANUAL_RATES, {})
        manual_rates_json = json.dumps(manual_rates, ensure_ascii=False, indent=2) if manual_rates else ""

        return vol.Schema(
            {
                vol.Required(
                    CONF_BIMONTHLY_ENERGY,
                    default=_get_config_value(self._config_entry, CONF_BIMONTHLY_ENERGY, ""),
                ): selector.selector({"entity": {"domain": "sensor"}}),
                vol.Required(
                    CONF_METER_START_DAY,
                    default=_get_config_value(self._config_entry, CONF_METER_START_DAY, ""),
                ): selector.selector({"date": {}}),
                vol.Required(
                    CONF_BILLING_MODE,
                    default=_get_config_value(self._config_entry, CONF_BILLING_MODE, DEFAULT_BILLING_MODE),
                ): selector.selector(
                    {"select": {"options": [
                        {"value": k, "label": v["name"]}
                        for k, v in BILLING_MODES.items()
                    ]}},
                ),
                vol.Optional(
                    CONF_MANUAL_RATES,
                    default=manual_rates_json,
                ): str,
            }
        )


def _get_config_value(config_entry, key, default):
    """Get config value from options first, then data."""
    if config_entry.options:
        return config_entry.options.get(key, default)
    return config_entry.data.get(key, default)

