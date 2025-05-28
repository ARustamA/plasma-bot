function validateDate(dateString) {
  const match = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return { valid: false, error: 'Формат даты должен быть: ДД.ММ.ГГГГ' };
  }

  const [_, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}`);

  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Неверная дата' };
  }

  return { valid: true, date: `${year}-${month}-${day}` };
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
}

function validateSnils(snils) {
  // Базовая проверка СНИЛС (можно расширить)
  const snilsRegex = /^\d{3}-\d{3}-\d{3}\s\d{2}$|^\d{11}$/;
  return snilsRegex.test(snils.replace(/\s/g, ''));
}

module.exports = {
  validateDate,
  validateEmail,
  validatePhone,
  validateSnils
};
