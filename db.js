const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'admin',
  database: 'renta_manteleria_cristaleria_db'
});

db.connect(err => {
  if (err) {
    console.error('Error conexión DB:', err);
    return;
  }
  console.log('Conectado a MySQL');
});

module.exports = db;