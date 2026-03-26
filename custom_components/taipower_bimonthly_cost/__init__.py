"""The TaiPower Energy Cost integration."""
import asyncio
import copy
import hashlib
import json
import logging
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

_MANIFEST_PATH = Path(__file__).parent / "manifest.json"
MANIFEST = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8")) if _MANIFEST_PATH.exists() else {}

CONFIG_SCHEMA = vol.Schema(
    {DOMAIN: vol.Schema({vol.Optional(CONF_BIMONTHLY_ENERGY): cv.string})},
    extra=vol.ALLOW_EXTRA,
)

_CARD_SRC_NAME = "taipower-config-card.js"
_CARD_STATIC_URL = "/taipower_static/taipower-config-card.js"


def _get_card_src() -> Path:
    """Return bundled Lovelace card path."""
    return Path(__file__).parent / "dist" / _CARD_SRC_NAME


def _get_card_js_url() -> str:
    """Return cache-busted card URL."""
    version = MANIFEST.get("version", "0")
    return f"{_CARD_STATIC_URL}?v={version}"


def _get_resources_path(hass: HomeAssistant) -> Path:
    """Return Lovelace resources storage path."""
    return Path(hass.config.config_dir) / ".storage" / "lovelace_resources"


def _resource_entry(url: str, existing: dict | None = None) -> dict:
    """Build a normalized Lovelace resource entry."""
    entry = {
        "url": url,
        "type": "module",
        "id": (existing or {}).get("id") or hashlib.md5(url.encode("utf-8")).hexdigest(),
    }
    return entry


def _register_lovelace_resource(hass: HomeAssistant) -> None:
    """Persist card resource in lovelace_resources without touching other resources."""
    res_path = _get_resources_path(hass)
    url = _get_card_js_url()

    try:
        with open(res_path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {
            "version": 1,
            "minor_version": 1,
            "key": "lovelace_resources",
            "data": {"resources": [], "items": []},
        }
    except json.JSONDecodeError as err:
        _LOGGER.error("Refusing to overwrite invalid lovelace_resources JSON: %s", err)
        return

    data_block = data.setdefault("data", {})
    items = data_block.get("items") if isinstance(data_block.get("items"), list) else []
    resources = data_block.get("resources") if isinstance(data_block.get("resources"), list) else []

    merged: list[dict] = []
    seen_urls: set[str] = set()

    for source in (items, resources):
        for item in source:
            if not isinstance(item, dict):
                continue
            item_url = item.get("url")
            if not item_url or item_url in seen_urls:
                continue
            merged.append(_resource_entry(item_url, item))
            seen_urls.add(item_url)

    target_index = next(
        (i for i, item in enumerate(merged) if _CARD_SRC_NAME in item.get("url", "") or "/taipower_" in item.get("url", "")),
        None,
    )
    if target_index is None:
        merged.append(_resource_entry(url))
    else:
        merged[target_index] = _resource_entry(url, merged[target_index])

    data_block["items"] = copy.deepcopy(merged)
    data_block["resources"] = copy.deepcopy(merged)

    with open(res_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the TaiPower component."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    async def handle_update_config(call):
        """Handle the update_config service call."""
        entry_id = call.data.get("entry_id")
        new_options = {}

        if CONF_BIMONTHLY_ENERGY in call.data:
            new_options[CONF_BIMONTHLY_ENERGY] = call.data[CONF_BIMONTHLY_ENERGY]
        if CONF_BILLING_MODE in call.data:
            new_options[CONF_BILLING_MODE] = call.data[CONF_BILLING_MODE]
        if CONF_METER_START_DAY in call.data:
            val = call.data[CONF_METER_START_DAY]
            new_options[CONF_METER_START_DAY] = (
                val.strftime("%Y-%m-%d") if hasattr(val, "strftime") else str(val)
            )
        if CONF_MANUAL_RATES in call.data:
            new_options[CONF_MANUAL_RATES] = call.data[CONF_MANUAL_RATES]

        if not entry_id:
            entries = hass.config_entries.async_entries(DOMAIN)
            if not entries:
                _LOGGER.error("No config entry found for %s", DOMAIN)
                return
            entry = entries[0]
        else:
            entry = hass.config_entries.async_get_entry(entry_id)
            if not entry:
                _LOGGER.error("Config entry %s not found", entry_id)
                return

        hass.config_entries.async_update_entry(entry, options={**entry.options, **new_options})
        await hass.config_entries.async_reload(entry.entry_id)
        _LOGGER.info("TaiPower config updated: %s", new_options)

    if not hass.services.has_service(DOMAIN, "update_config"):
        hass.services.async_register(
            DOMAIN,
            "update_config",
            handle_update_config,
            schema=vol.Schema(
                {
                    vol.Optional("entry_id"): cv.string,
                    vol.Optional(CONF_BIMONTHLY_ENERGY): cv.string,
                    vol.Optional(CONF_BILLING_MODE): vol.In(
                        ["residential", "non_commercial", "commercial"]
                    ),
                    vol.Optional(CONF_METER_START_DAY): cv.string,
                    vol.Optional(CONF_MANUAL_RATES): vol.Any(None, dict),
                }
            ),
        )

    card_src = _get_card_src()
    if card_src.is_file() and not domain_data.get("card_static_registered"):
        try:
            await hass.http.async_register_static_paths(
                [StaticPathConfig(_CARD_STATIC_URL, str(card_src), cache_headers=False)]
            )
            domain_data["card_static_registered"] = True
            _LOGGER.info("TaiPower card static path registered: %s -> %s", _CARD_STATIC_URL, card_src)
        except RuntimeError:
            domain_data["card_static_registered"] = True
            _LOGGER.debug("TaiPower card static path already registered: %s", _CARD_STATIC_URL)
    elif not card_src.is_file():
        _LOGGER.warning("TaiPower card JS file not found: %s", card_src)

    if card_src.is_file() and not domain_data.get("card_resource_registered"):
        try:
            frontend.add_extra_js_url(hass, _get_card_js_url())
            domain_data["card_resource_registered"] = True
            domain_data["card_resource_url"] = _get_card_js_url()
            _LOGGER.info("TaiPower card frontend resource registered: %s", _get_card_js_url())
        except ValueError:
            domain_data["card_resource_registered"] = True
            _LOGGER.debug("TaiPower card JS URL already registered: %s", _get_card_js_url())

        try:
            await hass.async_add_executor_job(_register_lovelace_resource, hass)
            _LOGGER.info("TaiPower card Lovelace resource persisted: %s", _get_card_js_url())
        except OSError as err:
            _LOGGER.warning("Failed to persist Lovelace resource: %s", err)

    return True


async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Set up a TaiPower Bimonthly Energy Cost entry."""
    if config_entry.data and not config_entry.options:
        hass.config_entries.async_update_entry(
            config_entry,
            data={},
            options=config_entry.data,
        )

    config_entry.async_on_unload(
        config_entry.add_update_listener(_async_options_updated)
    )

    data = hass.data.setdefault(DOMAIN, {})
    data[config_entry.entry_id] = {
        CONF_BIMONTHLY_ENERGY: _get_config_value(config_entry, CONF_BIMONTHLY_ENERGY, ""),
        CONF_BILLING_MODE: _get_config_value(
            config_entry, CONF_BILLING_MODE, DEFAULT_BILLING_MODE
        ),
    }

    await hass.config_entries.async_forward_entry_setups(config_entry, PLATFORMS)
    return True


async def _async_options_updated(
    hass: HomeAssistant, config_entry: ConfigEntry
) -> None:
    """Handle options update - reload integration to pick up new config."""
    await hass.config_entries.async_reload(config_entry.entry_id)


async def async_update_options(hass: HomeAssistant, config_entry: ConfigEntry):
    """Legacy compatibility wrapper for option updates."""
    await hass.config_entries.async_reload(config_entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Unload a config entry."""
    try:
        frontend.remove_extra_js_url(hass, _get_card_js_url())
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
    """Get config value from options first, then data, skipping empty values."""
    options_val = config_entry.options.get(key) if config_entry.options else None
    if options_val not in (None, ""):
        return options_val

    data_val = config_entry.data.get(key) if config_entry.data else None
    if data_val not in (None, ""):
        return data_val

    return default
