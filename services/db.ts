
import { SwapRecord } from '../types';

const DB_NAME = 'LGNS_Scanner_DB';
const STORE_NAME = 'swaps';
const VERSION = 1;

export class DatabaseService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('txHash', 'txHash', { unique: false });
          store.createIndex('trader', 'trader', { unique: false });
          store.createIndex('blockNumber', 'blockNumber', { unique: false });
          store.createIndex('composite', ['txHash', 'trader', 'direction'], { unique: true });
        }
      };

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        resolve();
      };

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    });
  }

  async saveSwaps(records: SwapRecord[]): Promise<void> {
    if (!this.db) await this.init();
    const tx = this.db!.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const record of records) {
      // Put used to handle unique constraint via index if we wanted, 
      // but IndexedDB's unique index will just error on add. 
      // We manually check or just try/catch.
      try {
        store.add(record);
      } catch (e) {
        // Skip duplicates
      }
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
    });
  }

  async getAllSwaps(): Promise<SwapRecord[]> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) await this.init();
    const tx = this.db!.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
    });
  }

  async getLastSyncedBlock(): Promise<number | null> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('blockNumber');
      const request = index.openCursor(null, 'prev');
      request.onsuccess = (event: any) => {
        const cursor = event.target.result;
        resolve(cursor ? cursor.value.blockNumber : null);
      };
    });
  }
}

export const dbService = new DatabaseService();
