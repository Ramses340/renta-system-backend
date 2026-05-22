const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const db = require('./db');
const fs = require('fs');
const path = require('path');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Carpeta para fotos de perfil
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ================= AUTH: LOGIN ================= */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM usuarios WHERE email=?', [email], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length === 0) return res.status(401).json({ message: 'Usuario no encontrado' });

    const user = result[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json(err);
      if (!isMatch) return res.status(401).json({ message: 'Contraseña incorrecta' });

      res.json({
        id_usuario: user.id_usuario,
        nombre: user.nombre,
        email: user.email,
        id_rol: user.id_rol
      });
    });
  });
});

/* ================= AUTH: REGISTER ================= */
app.post('/api/auth/register', (req, res) => {
  const { nombre, email, password, telefono } = req.body;
  const id_rol = 3; 

  if (!nombre || !email || !password || !telefono) {
    return res.status(400).json({ message: 'Faltan datos requeridos' });
  }

  db.query('SELECT * FROM usuarios WHERE email=? OR telefono=?', [email, telefono], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) return res.status(400).json({ message: 'Email o teléfono ya registrados' });

    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return res.status(500).json(err);
      db.query(
        'INSERT INTO usuarios (nombre, email, password, id_rol, telefono) VALUES (?, ?, ?, ?, ?)',
        [nombre, email, hashedPassword, id_rol, telefono],
        (err) => {
          if (err) return res.status(500).json(err);
          res.status(201).json({ message: 'Usuario registrado correctamente' });
        }
      );
    });
  });
});

/* ================= PRODUCTOS ================= */
app.get('/api/productos', (req, res) => {
  db.query('SELECT * FROM productos', (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

app.get('/api/productos/:categoria/:id', (req, res) => {
  const { categoria, id } = req.params;
  let tabla = (categoria === 'cristaleria') ? 'cristaleria' : 'manteleria';
  let idColumna = (categoria === 'cristaleria') ? 'id_cristaleria' : 'id_manteleria';

  db.query(`SELECT * FROM ${tabla} WHERE ${idColumna} = ?`, [id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length === 0) return res.status(404).json({ message: 'No encontrado' });

    const producto = result[0];
    producto.id = producto[idColumna];
    producto.categoria = categoria;
    res.json(producto);
  });
});

/* ================= CARRITO ================= */
app.post('/api/carrito', (req, res) => {
  const { id_usuario, categoria, id_producto, cantidad } = req.body;
  db.query('INSERT INTO carrito (id_usuario, categoria, id_producto, cantidad) VALUES (?, ?, ?, ?)', 
    [id_usuario, categoria, id_producto, cantidad], (err) => {
    if (err) return res.status(500).json(err);
    res.status(201).json({ message: 'Agregado al carrito' });
  });
});

app.get('/api/carrito/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;
  const query = `
    SELECT c.id_carrito, c.id_producto, c.cantidad, p.nombre, p.precio_dia, p.categoria 
    FROM carrito c 
    JOIN productos p ON c.id_producto = p.id AND c.categoria = p.categoria
    WHERE c.id_usuario = ?`;
  db.query(query, [id_usuario], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

app.delete('/api/carrito/:id_carrito', (req, res) => {
  db.query('DELETE FROM carrito WHERE id_carrito = ?', [req.params.id_carrito], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Item eliminado' });
  });
});

/* ================= RESERVACIONES (FINALIZAR RENTA) ================= */
app.post('/api/reservaciones/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;
  const { nombre_evento, fecha_entrega, fecha_devolucion } = req.body;

  const fEntrega = fecha_entrega || new Date().toISOString().split('T')[0];
  const fDevolucion = fecha_devolucion || fEntrega;

  const queryRes = `
    INSERT INTO reservaciones 
    (id_usuario, nombre_evento, fecha_evento, fecha_entrega, fecha_devolucion, estado_reserva) 
    VALUES (?, ?, ?, ?, ?, 'confirmada')`;
  
  db.query(queryRes, [id_usuario, nombre_evento || 'Renta App', fEntrega, fEntrega, fDevolucion], (err, result) => {
    if (err) return res.status(500).json(err);
    
    const id_res = result.insertId;
    const moveQuery = `
      INSERT INTO reservacion_detalles (id_reservacion, categoria, id_producto, nombre_producto, cantidad, precio_dia)
      SELECT ?, c.categoria, c.id_producto, p.nombre, c.cantidad, p.precio_dia
      FROM carrito c
      JOIN productos p ON c.id_producto = p.id AND c.categoria = p.categoria
      WHERE c.id_usuario = ?`;

    db.query(moveQuery, [id_res, id_usuario], (errDet) => {
      if (errDet) return res.status(500).json(errDet);
      db.query('DELETE FROM carrito WHERE id_usuario = ?', [id_usuario], () => {
        res.status(201).json({ message: 'Reservación creada' });
      });
    });
  });
});

/* ================= PANEL ADMIN: OBTENER TODAS LAS RESERVAS ================= */
app.get('/api/pedidos', (req, res) => {
  const query = `
    SELECT r.id_reservacion AS id_pedido, r.fecha_entrega AS fecha, r.estado_reserva AS estado, 
        u.nombre AS nombre_usuario, u.telefono, u.direccion, u.notas, u.preferencias 
    FROM reservaciones r 
    JOIN usuarios u ON r.id_usuario = u.id_usuario 
    ORDER BY r.created_at DESC`;

  db.query(query, (err, rentas) => {
    if (err) return res.status(500).json(err);
    
    const promesas = rentas.map(renta => {
      return new Promise((resolve) => {
        db.query('SELECT cantidad, categoria, nombre_producto FROM reservacion_detalles WHERE id_reservacion = ?', 
        [renta.id_pedido], (err, det) => {
          renta.detalles = det || [];
          resolve(renta);
        });
      });
    });
    Promise.all(promesas).then(resul => res.json(resul));
  });
});

/* ================= USUARIO: OBTENER MIS RESERVAS ================= */
app.get('/api/pedidos/usuario/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;
  const query = `
    SELECT id_reservacion AS id_pedido, fecha_entrega AS fecha, estado_reserva AS estado 
    FROM reservaciones 
    WHERE id_usuario = ? ORDER BY created_at DESC`;

  db.query(query, [id_usuario], (err, rentas) => {
    if (err) return res.status(500).json(err);
    
    const promesas = rentas.map(renta => {
        return new Promise(resolve => {
            db.query('SELECT cantidad, categoria, nombre_producto FROM reservacion_detalles WHERE id_reservacion = ?', 
            [renta.id_pedido], (err, det) => {
                renta.detalles = det || [];
                resolve(renta);
            });
        });
    });
    Promise.all(promesas).then(resul => res.json(resul));
  });
});

/* ================= ACTUALIZAR ESTADO (REPARADO PARA ENUM) ================= */
app.patch('/api/pedidos/:id_pedido/estado', (req, res) => {
  const { id_pedido } = req.params;
  const { estado } = req.query; // Recibe 'entregado' o 'cancelado'

  // TRADUCCIÓN: MySQL pide 'entregada' pero la App manda 'entregado'
  let estadoSQL = estado;
  if (estado === 'entregado') estadoSQL = 'entregada';
  if (estado === 'devuelto')  estadoSQL = 'devuelta';

  // Actualizamos tanto el estado de la reserva como el de la entrega
  let query = 'UPDATE reservaciones SET estado_reserva = ?';
  let params = [estadoSQL];

  if (estado === 'entregado') {
      query += ', estado_entrega = ?';
      params.push('entregado'); // Aquí sí es 'entregado' en tu SQL
  }

  query += ' WHERE id_reservacion = ?';
  params.push(id_pedido);
  
  db.query(query, params, (err, result) => {
    if (err) {
      console.error("Error SQL:", err.sqlMessage);
      return res.status(500).json({ error: err.sqlMessage });
    }
    res.json({ message: 'Estado actualizado correctamente' });
  });
});
/* ================= PERFIL ================= */
app.get('/api/usuarios/:id_usuario', (req, res) => {
  db.query('SELECT * FROM usuarios WHERE id_usuario = ?', [req.params.id_usuario], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result[0]);
  });
});

app.patch('/api/usuarios/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;
  const { direccion, notas, preferencias, imagen } = req.body;
  let campos = [], valores = [];

  if (direccion) { campos.push("direccion = ?"); valores.push(direccion); }
  if (notas) { campos.push("notas = ?"); valores.push(notas); }
  if (preferencias) { campos.push("preferencias = ?"); valores.push(preferencias); }
  if (imagen) { campos.push("imagen = ?"); valores.push(imagen); }

  if (campos.length === 0) return res.status(400).json({ message: "Sin datos" });
  valores.push(id_usuario);

  db.query(`UPDATE usuarios SET ${campos.join(", ")} WHERE id_usuario = ?`, valores, (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Perfil actualizado' });
  });
});

/* ================= NOTIFICACIONES ================= */
app.get('/api/notificaciones/usuario/:id_usuario', (req, res) => {
    db.query('SELECT * FROM notificaciones WHERE id_usuario = ? ORDER BY created_at DESC', [req.params.id_usuario], (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    });
});

/* ================= SERVER ================= */
app.listen(3000, () => {
  console.log('Servidor Doña Maya corriendo en puerto 3000');
});