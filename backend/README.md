# Backend — Mueblería Estilo y Confort

API REST con **Node.js + Express + MySQL + JWT** (FASE 1: autenticación y roles).

## Requisitos
- Node.js 18+
- MySQL 8.0+

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env      # edita credenciales de MySQL y secretos JWT
npm run db:seed           # crea BD, tablas, roles y usuario admin inicial
npm run dev               # arranca con nodemon en http://localhost:3000/api
```

> El frontend Angular ya apunta a `http://localhost:3000/api` (ver `src/environments/environment.ts`).

### Usuario admin inicial (creado por el seed)
- **email:** `admin@estiloyconfort.com`
- **password:** `Admin1234` — cámbiala tras el primer login.

## Estructura

```
src/
├── config/        database.js · environment.js · cors.js
├── middleware/    auth.js · roleValidator.js · errorHandler.js
├── controllers/   authController.js · userController.js
├── models/        User.js · Role.js
├── routes/        index.js · authRoutes.js · userRoutes.js
├── utils/         tokenUtils.js · validators.js · ApiError.js · asyncHandler.js
├── database/      schema.sql · seed.js
└── index.js       punto de entrada
```

## Endpoints

| Método | Ruta                              | Acceso        | Descripción                       |
|--------|-----------------------------------|---------------|-----------------------------------|
| GET    | `/api/health`                     | público       | Healthcheck                       |
| POST   | `/api/auth/login`                 | público       | Iniciar sesión                    |
| POST   | `/api/auth/register`              | público*      | Registro (rol visitor por defecto)|
| POST   | `/api/auth/refresh`               | público       | Renovar access token              |
| GET    | `/api/auth/me`                    | autenticado   | Datos del usuario actual          |
| GET    | `/api/users`                      | admin         | Listar usuarios                   |
| GET    | `/api/users/:id`                  | admin         | Detalle de usuario                |
| POST   | `/api/users`                      | admin         | Crear usuario (cualquier rol)     |
| PATCH  | `/api/users/:id`                  | admin         | Editar usuario                    |
| PATCH  | `/api/users/:id/toggle-status`    | admin         | Activar/desactivar                |
| DELETE | `/api/users/:id`                  | admin         | Eliminar usuario                  |

\* Para registrar con un rol distinto de `visitor` se requiere un token de admin.

## Ejemplos cURL

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@estiloyconfort.com","password":"Admin1234"}'

# Listar usuarios (usa el accessToken del login)
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Refrescar token
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

## Respuesta de autenticación

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { "id": 1, "email": "...", "fullName": "...", "role": "admin" }
}
```
