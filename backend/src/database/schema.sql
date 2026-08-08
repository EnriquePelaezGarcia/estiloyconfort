-- =====================================================================
-- Mueblería Estilo y Confort - Esquema FASE 1 (usuarios y roles)
-- Ejecutar en MySQL 8.0+
-- =====================================================================

CREATE DATABASE IF NOT EXISTS estilo_confort
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE estilo_confort;

CREATE TABLE IF NOT EXISTS roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role_id INT NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Roles base (idempotente)
INSERT INTO roles (name, description) VALUES
  ('visitor', 'Visitante anónimo'),
  ('seller', 'Vendedor de tienda'),
  ('manufacturer', 'Fabricante'),
  ('delivery_person', 'Repartidor'),
  ('admin', 'Administrador')
ON DUPLICATE KEY UPDATE description = VALUES(description);
