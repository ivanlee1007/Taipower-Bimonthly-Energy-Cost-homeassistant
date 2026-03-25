"""Config flow for TaiPower Energy Cost integration."""
import logging
from datetime import datetime

import voluptuous as vol

from homeassistant import config_entries, core
from homeassistant.helpers import selector

from .const import (
    CONFIG_FLOW_VERSION,
    CONF_BIMONTHLY_ENERGY,
    CONF_METER_START_DAY,
    CONF_BILLING_MODE,
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

