# Мессенджер приложение

Базовое мобильное приложение мессенджер с регистрацией, входом и обменом сообщениями в реальном времени.

## Технологии

**Backend:**
- Node.js + Express
- MySQL
- Socket.io (WebSocket)
- JWT аутентификация
- bcryptjs для хеширования паролей

**Frontend:**
- React Native
- React Navigation
- Axios для HTTP запросов
- Socket.io-client для WebSocket

## Установка и запуск

### 1. Настройка базы данных
Создайте базу данных MySQL с именем `messenger_db`

### 2. Запуск бэкенда
```bash
cd backend
npm install
npm start
```

### 3. Запуск мобильного приложения
```bash
cd MessengerApp
npm install
npx react-native run-android
# или
npx react-native run-ios
```

## Функциональность

- ✅ Регистрация пользователей
- ✅ Вход в систему
- ✅ Просмотр списка пользователей
- ✅ Отправка и получение сообщений
- ✅ Обмен сообщениями в реальном времени
- ✅ JWT аутентификация

## API Endpoints

- `POST /api/register` - Регистрация
- `POST /api/login` - Вход
- `GET /api/users` - Список пользователей
- `GET /api/messages/:userId` - Сообщения с пользователем
- `POST /api/messages` - Отправка сообщения