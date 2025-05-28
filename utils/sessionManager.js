const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(sessionFile = 'sessions.json') {
    this.sessionFile = sessionFile;
  }

  getUserData(chatId) {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        return null;
      }

      const sessions = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      return sessions[chatId] || null;
    } catch (error) {
      console.error('Ошибка при чтении сессий:', error);
      return null;
    }
  }

  saveUserData(chatId, userData) {
    try {
      let sessions = {};

      if (fs.existsSync(this.sessionFile)) {
        sessions = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      }

      sessions[chatId] = userData;

      fs.writeFileSync(this.sessionFile, JSON.stringify(sessions, null, 2));
      return true;
    } catch (error) {
      console.error('Ошибка при сохранении сессии:', error);
      return false;
    }
  }

  getAllUsers() {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        return {};
      }

      return JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
    } catch (error) {
      console.error('Ошибка при получении всех пользователей:', error);
      return {};
    }
  }

  deleteUserData(chatId) {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        return true;
      }

      const sessions = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      delete sessions[chatId];

      fs.writeFileSync(this.sessionFile, JSON.stringify(sessions, null, 2));
      return true;
    } catch (error) {
      console.error('Ошибка при удалении данных пользователя:', error);
      return false;
    }
  }
}

module.exports = SessionManager;
