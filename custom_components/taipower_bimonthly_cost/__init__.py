"""The TaiPower Energy Cost integration."""
import asyncio
import logging
import shutil
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_BIMONTHLY_ENERGY,
    CONF_BILLING_MODE,
    CONF_MANUAL_RATES,
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

# ── Card paths ──────────────────────────────────────────────────────────────
_CARD_SRC_NAME = "taipower-config-card.js"
_CARD_DIR_NAME = "taipower"
_CARD_JS_URL = "/taipower_static/taipower-config-card.js"


def _get_card_src(hass: HomeAssistant) -> Path:
    """Path to bundled JS in integration package."""
    return Path(__file__).parent / "dist" / _CARD_SRC_NAME


def _get_card_dst(hass: HomeAssistant) -> Path:
    """Target path in HA www/ (served via /local/)."""
    return Path(hass.config.config_dir) / "www" / _CARD_DIR_NAME / _CARD_SRC_NAME


def _install_card_js(hass: HomeAssistant) -> bool:
    """Copy JS to www/ for persistence. Returns True if successful."""
    src = _get_card_src(hass)
    dst = _get_card_dst(hass)

    if not src.exists():
        _LOGGER.warning("TaiPower card JS not found at %s", src)
        return False

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    _LOGGER.info("TaiPower card JS installed to %s", dst)
    return True


def _get_card_js_url(hass: HomeAssistant) -> str:
    """Return card JS URL with mtime-based cache busting."""
    dst = _get_card_dst(hass)
    try:
        mtime = int(dst.stat().st_mtime)
    except (FileNotFoundError, OSError):
        mtime = 0
    return f"/local/{_CARD_DIR_NAME}/{_CARD_SRC_NAME}?v={mtime}"


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the TaiPower component."""
    hass.data.setdefault(DOMAIN, {})

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
        if CONF_MANUAL_RATES in call.data:
            new_options[CONF_MANUAL_RATES] = call.data[CONF_MANUAL_RATES]

        if not entry_id:
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
                vol.Optional(CONF_MANUAL_RATES): vol.Any(None, dict),
            }
        ),
    )

    return True


async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Set up a TaiPower Bimonthly Energy Cost entry."""
    # migrate data to options
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

    # ── Card installation (every restart, not just first setup) ──
    # Copy JS to www/ for persistence
    await hass.async_add_executor_job(_install_card_js, hass)

    # Register static path so HA serves the JS file
    src = _get_card_src(hass)
    if src.exists():
        try:
            await hass.http.async_register_static_paths([
                StaticPathConfig(
                    _CARD_JS_URL,
                    str(src),
                    cache_headers=True,
                )
            ])
        except RuntimeError:
            _LOGGER.debug("TaiPower card static path already registered: %s", _CARD_JS_URL)
        try:
            frontend.add_extra_js_url(hass, _get_card_js_url(hass))
        except ValueError:
            _LOGGER.debug("TaiPower card JS URL already registered: %s", _get_card_js_url(hass))
        _LOGGER.info("TaiPower card registered: %s -> %s", _CARD_JS_URL, src)
    else:
        _LOGGER.warning("TaiPower card JS file not found: %s", src)

    await hass.config_entries.async_forward_entry_setups(config_entry, PLATFORMS)
    return True


async def async_update_options(hass: HomeAssistant, config_entry: ConfigEntry):
    """Update options."""
    await hass.config_entries.async_reload(config_entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Unload a config entry."""
    # Clean up frontend JS registration
    try:
        frontend.remove_extra_js_url(hass, _get_card_js_url(hass))
    except (ValueError, AttributeError):
        pass

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
