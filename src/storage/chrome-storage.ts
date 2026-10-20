import { browser, type Browser } from 'wxt/browser';
import {
  createStorageRepository,
  type StoragePort,
  type StorageRepository,
} from './repository';

const LOCAL_AREA_NAME = 'local';

export function createChromeStoragePort(): StoragePort {
  return {
    async readAll() {
      return browser.storage.local.get(null);
    },

    async set(items) {
      await browser.storage.local.set(items);
    },

    async remove(keys) {
      await browser.storage.local.remove(keys);
    },

    subscribe(listener) {
      function handleChange(
        changes: Record<string, Browser.storage.StorageChange>,
        areaName: Browser.storage.AreaName,
      ) {
        if (areaName !== LOCAL_AREA_NAME) {
          return;
        }
        listener(Object.keys(changes));
      }

      browser.storage.onChanged.addListener(handleChange);
      return () => {
        browser.storage.onChanged.removeListener(handleChange);
      };
    },
  };
}

export function createChromeStorageRepository(): StorageRepository {
  return createStorageRepository(createChromeStoragePort());
}
