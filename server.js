const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

/* ================= LOGIN ================= */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM usuarios WHERE email=?', [email], (err, result) => {
    if (err) return res.status(500).json(err);

    if (result.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const user = result[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json(err);
      if (!isMatch) {
        return res.status(401).json({ message: 'Contraseña incorrecta' });
      }

      const rol = user.id_rol === 1 ? 'admin' : 'usuario';
      res.json({
        id: user.id_usuario,
        nombre: user.nombre,
        email: user.email,
        id_rol: user.id_rol

      });
    });
  });
});

/* ================= REGISTER ================= */
app.post('/api/auth/register', (req, res) => {
  const { nombre, email, password, telefono } = req.body;
  const id_rol = 3;

  if (!nombre || !email || !password || !telefono) {
    return res.status(400).json({ message: 'Faltan datos requeridos' });
  }

  // 1. Verificar si el email ya existe
  db.query('SELECT * FROM usuarios WHERE email=?', [email], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }

    // 2. Verificar si el teléfono ya existe (NUEVO)
    db.query('SELECT * FROM usuarios WHERE telefono=?', [telefono], (err, result) => {
      if (err) return res.status(500).json(err);
      if (result.length > 0) {
        return res.status(400).json({ message: 'El teléfono ya está registrado' });
      }

      // 3. Si nada está repetido, insertar
      bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) return res.status(500).json(err);

        db.query(
          'INSERT INTO usuarios (nombre, email, password, id_rol, telefono) VALUES (?, ?, ?, ?, ?)',
          [nombre, email, hashedPassword, id_rol, telefono],
          (err, result) => {
            if (err) return res.status(500).json(err);
            res.status(201).json({ message: 'Usuario registrado correctamente' });
          }
        );
      });
    });
  });
});
/* ================= CARRITO ================= */
app.post('/api/carrito', (req, res) => {
  const { id_usuario, categoria, id_producto, cantidad } = req.body;

  const query = 'INSERT INTO carrito (id_usuario, categoria, id_producto, cantidad) VALUES (?, ?, ?, ?)';
  db.query(query, [id_usuario, categoria, id_producto, cantidad], (err, result) => {
    if (err) return res.status(500).json(err);
    res.status(201).json({ message: 'Agregado al carrito' });
  });
});

// Ruta para ver el carrito de un usuario
app.get('/api/carrito/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;
  const query = `
    SELECT c.id_carrito, c.cantidad, p.nombre, p.precio_dia, p.categoria 
    FROM carrito c 
    JOIN productos p ON c.id_producto = p.id AND c.categoria = p.categoria
    WHERE c.id_usuario = ?`;
    
  db.query(query, [id_usuario], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

/* ================= CARRITO Y PEDIDOS ================= */

// 1. Obtener los productos del carrito de un usuario
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

// 2. Eliminar un item del carrito
app.delete('/api/carrito/:id_carrito', (req, res) => {
  const { id_carrito } = req.params;
  db.query('DELETE FROM carrito WHERE id_carrito = ?', [id_carrito], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Item eliminado' });
  });
});

// 3. FINALIZAR RENTA (Crea el pedido y limpia el carrito)
app.post('/api/pedidos/:id_usuario', (req, res) => {
  const { id_usuario } = req.params;

  // Primero creamos el registro en la tabla 'pedidos'
  db.query('INSERT INTO pedidos (id_usuario, estado) VALUES (?, "pendiente")', [id_usuario], (err, result) => {
    if (err) return res.status(500).json(err);
    
    const id_pedido = result.insertId;

    // Pasamos los items del carrito a 'pedido_detalles'
    const moveQuery = `
      INSERT INTO pedido_detalles (id_pedido, categoria, id_producto, cantidad, precio_unitario)
      SELECT ?, c.categoria, c.id_producto, c.cantidad, p.precio_dia
      FROM carrito c
      JOIN productos p ON c.id_producto = p.id AND c.categoria = p.categoria
      WHERE c.id_usuario = ?`;

    db.query(moveQuery, [id_pedido, id_usuario], (err2) => {
      if (err2) return res.status(500).json(err2);

      // Finalmente limpiamos el carrito del usuario
      db.query('DELETE FROM carrito WHERE id_usuario = ?', [id_usuario], (err3) => {
        if (err3) return res.status(500).json(err3);
        res.json({ message: 'Pedido finalizado con éxito', id_pedido });
      });
    });
  });
});

/* ================= DETALLE DE PRODUCTO ================= */
app.get('/api/productos/:categoria/:id', (req, res) => {
  const { categoria, id } = req.params;

  // Decidimos tabla y nombre de columna ID según la categoría
  let tabla = (categoria === 'cristaleria') ? 'cristaleria' : 'manteleria';
  let idColumna = (categoria === 'cristaleria') ? 'id_cristaleria' : 'id_manteleria';

  const query = `SELECT * FROM ${tabla} WHERE ${idColumna} = ?`;

  db.query(query, [id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length === 0) return res.status(404).json({ message: 'No encontrado' });

    // IMPORTANTE: Para que la App lo entienda bien, mapeamos el ID
    const producto = result[0];
    producto.id = producto[idColumna]; // Estandarizamos el ID
    producto.categoria = categoria;    // Aseguramos la categoría

    res.json(producto);
  });
});

/* ================= PRODUCTOS ================= */
app.get('/api/productos', (req, res) => {
  db.query('SELECT * FROM productos', (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

/* ================= SERVER ================= */
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});