# SunTour Chocó - Node.js simple

Proyecto nuevo de turismo hecho con Node.js puro, usando la base de datos `turismo` y las imágenes del proyecto Laravel.

## Ventajas

- No usa Docker.
- No necesita `npm install`.
- No depende de paquetes externos.
- Se ejecuta con una sola terminal.
- Usa MySQL de XAMPP por medio de `mysql.exe`.

## Pasos

1. Abre XAMPP y enciende **MySQL**.
2. En phpMyAdmin crea/importa la base de datos usando:

```text
database/turismo.sql
```

La base debe llamarse:

```text
turismo
```

3. Ejecuta:

```powershell
cd C:\xampp\htdocs\suntour_nuevo_node
npm start
```

4. Abre:

```text
http://localhost:3000
```

## Usuarios

Puedes registrarte desde `/register`. Los usuarios nuevos se guardan en la tabla `usuarios`.

Los usuarios existentes de Laravel tienen contraseñas bcrypt de PHP. Como este proyecto no usa librerías externas, esos hashes no se pueden verificar directamente. Para probar rápido, registra un usuario nuevo desde la app.

## Importante

Este proyecto fue hecho para ser sencillo y funcional en Windows/XAMPP. Internamente está organizado por páginas, rutas y consultas, pero todo corre desde una sola app Node.js.
