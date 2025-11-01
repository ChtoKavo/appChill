const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// MySQL подключение
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true
});

db.connect((err) => {
  if (err) {
    console.error('Ошибка подключения к MySQL:', err);
    return;
  }
  console.log('Подключено к MySQL');
  
  // Создание таблиц
  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sender_id INT NOT NULL,
      receiver_id INT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    )
  `);
});

// Middleware для проверки токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.sendStatus(401);
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  console.log('Данные регистрации:', { username, email, password });
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword],
      (err, result) => {
        if (err) {
          console.error('Ошибка БД:', err);
          if (err.code === 'ER_DUP_ENTRY') {
            if (err.sqlMessage.includes('username')) {
              return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
            }
            if (err.sqlMessage.includes('email')) {
              return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }
          }
          return res.status(400).json({ error: 'Ошибка регистрации' });
        }
        res.json({ message: 'Пользователь создан' });
      }
    );
  } catch (error) {
    console.error('Ошибка сервера:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log('Данные входа:', { email, password });
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('Ошибка БД:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    
    if (results.length === 0) {
      return res.status(400).json({ error: 'Пользователь не найден' });
    }
    
    const user = results[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, avatar: user.avatar, bio: user.bio, status: user.status } });
  });
});

// Получить всех пользователей
app.get('/api/users', authenticateToken, (req, res) => {
  db.query('SELECT id, username, email, avatar, status FROM users WHERE id != ?', [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(results);
  });
});

// Получить сообщения между пользователями
app.get('/api/messages/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  db.query(`
    SELECT m.*, u.username as sender_name 
    FROM messages m 
    JOIN users u ON m.sender_id = u.id 
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
  `, [req.user.id, userId, userId, req.user.id], (err, results) => {
    if (err) {
      console.error('Ошибка загрузки сообщений:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json(results);
  });
});

// Отправить сообщение
app.post('/api/messages', authenticateToken, (req, res) => {
  const { receiver_id, message } = req.body;
  
  db.query(
    'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
    [req.user.id, receiver_id, message],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      
      const messageData = {
        id: result.insertId,
        sender_id: req.user.id,
        receiver_id,
        message,
        sender_name: req.user.username,
        created_at: new Date()
      };
      
      // Отправить сообщение через WebSocket
      console.log('Отправка сообщения через WebSocket:', messageData);
      io.emit('new_message', messageData);
      
      res.json(messageData);
    }
  );
});

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
  });
});

// Получить профиль пользователя
app.get('/api/profile', authenticateToken, (req, res) => {
  db.query('SELECT id, username, email, avatar, bio, status FROM users WHERE id = ?', [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (results.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(results[0]);
  });
});

// Обновить профиль
app.put('/api/profile', authenticateToken, (req, res) => {
  const { username, bio, status, avatar } = req.body;
  
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Имя должно быть минимум 3 символа' });
  }
  
  db.query(
    'UPDATE users SET username = ?, bio = ?, status = ?, avatar = ? WHERE id = ?',
    [username, bio || null, status || 'Онлайн', avatar || null, req.user.id],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
        }
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      res.json({ message: 'Профиль обновлен' });
    }
  );
});

// Получить все посты
app.get('/api/posts', authenticateToken, (req, res) => {
  db.query(`
    SELECT p.*, u.username, u.avatar,
           COUNT(DISTINCT l.id) as likes_count,
           COUNT(DISTINCT c.id) as comments_count,
           EXISTS(SELECT 1 FROM likes WHERE user_id = ? AND post_id = p.id) as is_liked
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN likes l ON p.id = l.post_id
    LEFT JOIN comments c ON p.id = c.post_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `, [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(results);
  });
});

// Создать пост
app.post('/api/posts', authenticateToken, (req, res) => {
  const { content, image } = req.body;
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Текст поста обязателен' });
  }
  
  db.query(
    'INSERT INTO posts (user_id, content, image) VALUES (?, ?, ?)',
    [req.user.id, content, image || null],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ id: result.insertId, message: 'Пост создан' });
    }
  );
});

// Лайкнуть/убрать лайк
app.post('/api/posts/:postId/like', authenticateToken, (req, res) => {
  const { postId } = req.params;
  
  db.query('SELECT * FROM likes WHERE user_id = ? AND post_id = ?', [req.user.id, postId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    
    if (results.length > 0) {
      // Убрать лайк
      db.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [req.user.id, postId], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ liked: false, message: 'Лайк убран' });
      });
    } else {
      // Поставить лайк
      db.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.user.id, postId], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ liked: true, message: 'Лайк поставлен' });
      });
    }
  });
});

// Добавить комментарий
app.post('/api/posts/:postId/comments', authenticateToken, (req, res) => {
  const { postId } = req.params;
  const { comment } = req.body;
  
  if (!comment || comment.trim().length === 0) {
    return res.status(400).json({ error: 'Комментарий не может быть пустым' });
  }
  
  db.query(
    'INSERT INTO comments (user_id, post_id, comment) VALUES (?, ?, ?)',
    [req.user.id, postId, comment],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ id: result.insertId, message: 'Комментарий добавлен' });
    }
  );
});

// Получить комментарии к посту
app.get('/api/posts/:postId/comments', authenticateToken, (req, res) => {
  const { postId } = req.params;
  
  db.query(`
    SELECT c.*, u.username, u.avatar
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `, [postId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(results);
  });
});

// Поиск пользователей
app.get('/api/users/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Запрос должен содержать минимум 2 символа' });
  }
  
  db.query(`
    SELECT u.id, u.username, u.email, u.avatar,
           f.status as friend_status,
           CASE 
             WHEN f.user_id = ? THEN 'sent'
             WHEN f.friend_id = ? THEN 'received'
             ELSE NULL
           END as request_direction
    FROM users u
    LEFT JOIN friends f ON (f.user_id = ? AND f.friend_id = u.id) OR (f.friend_id = ? AND f.user_id = u.id)
    WHERE (u.username LIKE ? OR u.email LIKE ?) AND u.id != ?
    LIMIT 20
  `, [req.user.id, req.user.id, req.user.id, req.user.id, `%${q}%`, `%${q}%`, req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(results);
  });
});

// Получить список друзей
app.get('/api/friends', authenticateToken, (req, res) => {
  db.query(`
    SELECT u.id, u.username, u.email, u.avatar, f.status
    FROM friends f
    JOIN users u ON (f.friend_id = u.id OR f.user_id = u.id)
    WHERE (f.user_id = ? OR f.friend_id = ?) AND u.id != ?
    ORDER BY f.created_at DESC
  `, [req.user.id, req.user.id, req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(results);
  });
});

// Отправить заявку в друзья
app.post('/api/friends/request/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  if (userId == req.user.id) {
    return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
  }
  
  db.query(
    'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")',
    [req.user.id, userId],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ error: 'Заявка уже отправлена' });
        }
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      res.json({ message: 'Заявка в друзья отправлена' });
    }
  );
});

// Принять заявку в друзья
app.post('/api/friends/accept/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  db.query(
    'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ? AND status = "pending"',
    [userId, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Заявка не найдена' });
      }
      res.json({ message: 'Заявка принята' });
    }
  );
});

// Удалить из друзей
app.delete('/api/friends/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  db.query(
    'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
    [req.user.id, userId, userId, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ message: 'Удалено из друзей' });
    }
  );
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});