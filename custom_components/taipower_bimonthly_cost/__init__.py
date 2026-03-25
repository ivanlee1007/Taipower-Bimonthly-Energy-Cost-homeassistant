"""The TaiPower Energy Cost integration."""
import asyncio
import logging
import os

import voluptuous as vol

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_BIMONTHLY_ENERGY,
    CONF_BILLING_MODE,
    CONF_METER_START_DAY,
    DEFAULT_BILLING_MODE,
    DOMAIN,
    PLATFORMS,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema(
    {DOMAIN: vol.Schema({vol.Optional(CONF_BIMONTHLY_ENERGY): cv.string})},
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the TaiPower component."""
    hass.data.setdefault(DOMAIN, {})

    # Register static path for config card
    card_path = os.path.join(os.path.dirname(__file__), "..", "dist")
    card_file = os.path.join(card_path, "taipower-config-card.js")
    if os.path.isfile(card_file):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                "/taipower_static/taipower-config-card.js",
                card_file,
                cache_headers=True,
            )
        ])

    async def handle_update_config(call):
        """Handle the update_config service call."""
        entry_id = call.data.get("entry_id")
        new_options = {}

        if CONF_BIMONTHLY_ENERGY in call.data:
            new_options[CONF_BIMONTHLY_ENERGY] = call.data[CONF_BIMONTHLY_ENERGY]
        if CONF_BILLING_MODE in call.data:
            new_options[CONF_BILLING_MODE] = call.data[CONF_BILLING_MODE]
        if CONF_METER_START_DAY in call.data:
            new_options[CONF_METER_START_DAY] = call.data[CONF_METER_START_DAY]

        if not entry_id:
            # Find entry by domain
            entries = hass.config_entries.async_entries(DOMAIN)
            if entries:
                entry = entries[0]
            else:
                _LOGGER.error("No config entry found for %s", DOMAIN)
                return
        else:
            entry = hass.config_entries.async_get_entry(entry_id)
            if not entry:
                _LOGGER.error("Config entry %s not found", entry_id)
                return

        hass.config_entries.async_update_entry(entry, options={**entry.options, **new_options})
        await hass.config_entries.async_reload(entry.entry_id)
        _LOGGER.info("TaiPower config updated: %s", new_options)

    hass.services.async_register(
        DOMAIN,
        "update_config",
        handle_update_config,
        schema=vol.Schema(
            {
                vol.Optional("entry_id"): cv.string,
                vol.Optional(CONF_BIMONTHLY_ENERGY): cv.string,
                vol.Optional(CONF_BILLING_MODE): vol.In(["residential", "non_commercial", "commercial"]),
                vol.Optional(CONF_METER_START_DAY): cv.date,
            }
        ),
    )

    return True


async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Set up a TaiPower Bimonthly Energy Cost entry."""

    # migrate data (also after first setup) to options
    if config_entry.data:
        hass.config_entries.async_update_entry(
            config_entry, data={}, options=config_entry.data
        )

    data = hass.data.setdefault(DOMAIN, {})
    data[config_entry.entry_id] = {
        CONF_BIMONTHLY_ENERGY: _get_config_value(
            config_entry, CONF_BIMONTHLY_ENERGY, ""
        ),
        CONF_BILLING_MODE: _get_config_value(
            config_entry, CONF_BILLING_MODE, DEFAULT_BILLING_MODE
        ),
    }

    await hass.config_entries.async_forward_entry_setups(config_entry, PLATFORMS)
    return True


async def async_update_options(hass: HomeAssistant, config_entry: ConfigEntry):
    """Update options."""
    await hass.config_entries.async_reload(config_entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Unload a config entry."""
    unload_ok = all(
        await asyncio.gather(
            *[
                hass.config_entries.async_forward_entry_unload(config_entry, platform)
                for platform in PLATFORMS
            ]
        )
    )
    return unload_ok


def _get_config_value(config_entry, key, default):
    if config_entry.options:
        return config_entry.options.get(key, default)
    return config_entry.data.get(key, default)
