"""Button entity for Taipower rate update."""
import asyncio
import logging
import os

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up Taipower button entities."""
    async_add_entities([TaipowerUpdateRatesButton(hass, entry)], True)


class TaipowerUpdateRatesButton(ButtonEntity):
    """Button to manually trigger Taipower rate PDF update."""

    _attr_has_entity_name = True
    _attr_translation_key = "update_rates"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self._hass = hass
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_update_rates"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "台電雙月電費",
            "manufacturer": "UNiNUS",
            "model": "TaiPower Cost Calculator",
        }
        self._last_result: str | None = None

    @property
    def extra_state_attributes(self):
        attrs = {}
        if self._last_result:
            attrs["last_result"] = self._last_result
        return attrs

    async def _ensure_deps(self, scripts_dir: str) -> str | None:
        """Install npm deps if node_modules is missing. Returns error or None."""
        node_modules = os.path.join(scripts_dir, "node_modules")
        if os.path.isdir(node_modules):
            return None  # already installed
        proc = await asyncio.create_subprocess_exec(
            "npm", "install", "--production",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=scripts_dir,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return f"npm install failed: {stderr.decode().strip()}"
        _LOGGER.info("npm deps installed in %s", scripts_dir)
        return None

    async def async_press(self) -> None:
        """Handle button press — run update_rates.js via Node.js."""
        hass_config_dir = self._hass.config.config_dir
        integration_dir = os.path.join(
            hass_config_dir, "custom_components", "taipower_bimonthly_cost"
        )
        scripts_dir = os.path.join(integration_dir, "scripts")
        script_path = os.path.join(scripts_dir, "update_rates.js")

        # Verify node is available
        try:
            proc = await asyncio.create_subprocess_exec(
                "node", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode != 0:
                raise FileNotFoundError("node not found")
            _LOGGER.info("Node.js version: %s", stdout.decode().strip())
        except (FileNotFoundError, OSError) as err:
            self._last_result = f"❌ Node.js 未安裝: {err}"
            _LOGGER.error(self._last_result)
            return

        # Verify script exists
        if not os.path.isfile(script_path):
            self._last_result = f"❌ 找不到腳本: {script_path}"
            _LOGGER.error(self._last_result)
            return

        # Auto-install npm deps if needed
        dep_err = await self._ensure_deps(scripts_dir)
        if dep_err:
            self._last_result = f"❌ 依賴安裝失敗: {dep_err}"
            _LOGGER.error(self._last_result)
            return

        # Run the update script
        try:
            proc = await asyncio.create_subprocess_exec(
                "node", script_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=integration_dir,
            )
            stdout, stderr = await proc.communicate()
            output = stdout.decode().strip()
            err_output = stderr.decode().strip()

            if proc.returncode == 0:
                self._last_result = f"✅ {output}"
                _LOGGER.info("Rate update succeeded:\n%s", output)
                # Reload the config entry to pick up new rates
                await self._hass.config_entries.async_reload(self._entry.entry_id)
            else:
                self._last_result = f"❌ 失敗: {err_output or output}"
                _LOGGER.error("Rate update failed: %s", err_output)

        except Exception as err:
            self._last_result = f"❌ 執行錯誤: {err}"
            _LOGGER.exception("Rate update error")
