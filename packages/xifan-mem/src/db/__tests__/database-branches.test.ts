import { describe, expect, it } from 'vitest';

import { MemoryDatabaseManager } from '../database.js';

describe('MemoryDatabaseManager branch coverage', () => {
  it('rejects database path outside .xifan/coder when allowExternalDbPath is false', () => {
    expect(() => new MemoryDatabaseManager({ dbPath: '/tmp/rogue.db' })).toThrow(
      'Database path must be under',
    );
  });

  it('allows :memory: without allowExternalDbPath', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    manager.migrate();
    manager.close();
  });

  it('close is a no-op when database is not yet opened', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    // close before getConnection - should not throw
    manager.close();
  });

  it('close twice is safe', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    manager.migrate();
    manager.close();
    // Second close should be a no-op (db already undefined)
    manager.close();
  });

  it('getDatabasePath returns the configured path', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    expect(manager.getDatabasePath()).toBe(':memory:');
    manager.close();
  });

  it('getConnection returns same instance on repeated calls', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    manager.migrate();
    const db1 = manager.getConnection();
    const db2 = manager.getConnection();
    expect(db1).toBe(db2);
    manager.close();
  });
});
