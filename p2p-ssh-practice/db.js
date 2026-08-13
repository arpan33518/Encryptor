async function initDb(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS peers(
      public_key TEXT PRIMARY KEY,
      name TEXT,
      ip TEXT,
      port INTEGER
    )
  `);
  try {
    await db.exec(`ALTER TABLE peers ADD COLUMN ip TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    await db.exec(`ALTER TABLE peers ADD COLUMN port INTEGER;`);
  } catch (e) {
    // Column already exists
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages(
      Message_Id TEXT PRIMARY KEY, 
      Sender TEXT,
      Receiver TEXT,
      Content TEXT,
      Timestamp INTEGER,
      Status TEXT
    )
  `);
}

module.exports = { initDb };
