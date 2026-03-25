"""Config flow for TaiPower Energy Cost integration."""
import json
import logging
from datetime import datetime
import voluptuous as vol

from homeassistant import config_entries, core, exceptions
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv
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
    """Validate that the user input allows us to connect to DataPoint.

    Data has the keys from DATA_SCHEMA with values provided by the user.
    """
    states_source = hass.states.get(data[CONF_BIMONTHLY_ENERGY])
    if states_source is None:
        raise EntityNotExist
    return True


class TaiPowerCostFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for TaiPower Energy Cost integration."""

    VERSION = CONFIG_FLOW_VERSION

    @classmethod
    def async_get_options_flow(cls, config_entry: ConfigEntry):
        """ get option flow """
        return TaiPowerCostOptionsFlow(config_entry)

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        if user_input is not None:
            taipower_energy_cost = "taipower_energy_cost"
            await self.async_set_unique_id(
                    f"{taipower_energy_cost}-{user_input[CONF_BIMONTHLY_ENERGY]}"
                )
            self._abort_if_unique_id_configured()

            ret = False
            try:
                ret = await validate_input(self.hass, user_input)
            except EntityNotExist:
                errors["base"] = "entitynotexist"
            except ValueError:
                errors["base"] = "dataformaterror"
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"

            if ret:
                title = "TaiPower Energy Cost"
                return self.async_create_entry(
                    title=title, data=user_input
                )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_BIMONTHLY_ENERGY): selector.selector(
                    {"entity": {"domain": "sensor"}},
                ),
                vol.Required(
                    CONF_METER_START_DAY,
                    default=datetime.now().strftime("%Y-%m-%d")): selector.selector(
                        {"date": {}},
                    ),
                vol.Required(
                    CONF_BILLING_MODE,
                    default=DEFAULT_BILLING_MODE,
                ): selector.selector(
                    {"select": {"options": [
                        {"value": k, "label": v["name"]}
                        for k, v in BILLING_MODES.items()
                    ]}},
                ),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )


class TaiPowerCostOptionsFlow(config_entries.OptionsFlow):
    """Handle options."""

    def __init__(self, config_entry):
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            errors = {}
            ret = False
            try:
                ret = await validate_input(self.hass, user_input)
            except EntityNotExist:
                errors["base"] = "entitynotexist"
            except ValueError:
                errors["base"] = "dataformaterror"
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"
            if ret:
                # Parse and validate manual rates JSON
                manual_rates = user_input.pop(CONF_MANUAL_RATES, "")
                if manual_rates and manual_rates.strip():
                    try:
                        parsed = json.loads(manual_rates)
                        if not isinstance(parsed, dict):
                            errors["base"] = "manual_rates_format"
                        else:
                            for mode, data in parsed.items():
                                if mode not in BILLING_MODES:
                                    raise ValueError(f"Unknown mode: {mode}")
                                if not isinstance(data, dict):
                                    raise ValueError(f"{mode} must be an object")
                                summer = data.get("summer", [])
                                non_summer = data.get("non_summer", [])
                                if not isinstance(summer, list) or not isinstance(non_summer, list):
                                    raise ValueError(f"{mode}: summer/non_summer must be arrays")
                                if len(summer) != len(non_summer):
                                    raise ValueError(f"{mode}: summer and non_summer must have same length")
                                if any(not isinstance(v, (int, float)) for v in summer + non_summer):
                                    raise ValueError(f"{mode}: rates must be numbers")
                                if any(v <= 0 for v in summer + non_summer):
                                    raise ValueError(f"{mode}: rates must be positive")
                            user_input[CONF_MANUAL_RATES] = parsed
                    except json.JSONDecodeError:
                        errors["base"] = "manual_rates_format"
                    except ValueError as e:
                        _LOGGER.warning("Manual rates validation failed: %s", e)
                        errors["base"] = "manual_rates_format"
                else:
                    user_input[CONF_MANUAL_RATES] = {}

                if not errors:
                    return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=self._get_options_schema(),
            errors=errors,
        )

    def _get_options_schema(self):
        # Build example JSON for current billing mode
        current_mode = _get_config_value(
            self.config_entry, CONF_BILLING_MODE, DEFAULT_BILLING_MODE)
        default_tiers = BILLING_MODES.get(current_mode, {}).get("tiers", [])
        example = {
            current_mode: {
                "summer": [t["rate_summer"] for t in default_tiers],
                "non_summer": [t["rate_non_summer"] for t in default_tiers],
            }
        }
        # manual_rates default: if already saved as dict, show as JSON; else empty
        raw_manual = _get_config_value(self.config_entry, CONF_MANUAL_RATES, "")
        if isinstance(raw_manual, dict):
            manual_default = json.dumps(raw_manual, ensure_ascii=False)
        else:
            manual_default = raw_manual or ""
        return vol.Schema(
            {
                vol.Required(
                    CONF_BIMONTHLY_ENERGY,
                    default=_get_config_value(
                        self.config_entry, CONF_BIMONTHLY_ENERGY, "")
                ): selector.selector(
                    {"entity": {"domain": "sensor"}},
                ),
                vol.Required(
                    CONF_METER_START_DAY,
                    default=_get_config_value(
                        self.config_entry, CONF_METER_START_DAY, ""),
                ): selector.selector({"date": {}}),
                vol.Required(
                    CONF_BILLING_MODE,
                    default=_get_config_value(
                        self.config_entry, CONF_BILLING_MODE, DEFAULT_BILLING_MODE),
                ): selector.selector(
                    {"select": {"options": [
                        {"value": k, "label": v["name"]}
                        for k, v in BILLING_MODES.items()
                    ]}},
                ),
                vol.Optional(
                    CONF_MANUAL_RATES,
                    default=manual_default,
                ): selector.selector({
                    "text": {
                        "multiline": True,
                        "placeholder": json.dumps(example, ensure_ascii=False),
                    },
                }),
            }
        )


def _get_config_value(config_entry, key, default):
    if config_entry.options:
        return config_entry.options.get(key, default)
    return config_entry.data.get(key, default)


class EntityNotExist(exceptions.HomeAssistantError):
    """Error to indicate Entity not exist."""
