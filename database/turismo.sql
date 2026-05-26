-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 31-05-2025 a las 06:17:55
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `turismo`
--

DELIMITER $$
--
-- Procedimientos
--
CREATE DEFINER=`root`@`localhost` PROCEDURE `InsertarReserva` (IN `p_ID_Usuario` INT, IN `p_ID_Servicio` INT, IN `p_Personas` INT)   BEGIN
    INSERT INTO reservas (ID_Usuario, ID_Servicio, Personas, Fecha, Estado)
    VALUES (p_ID_Usuario, p_ID_Servicio, p_Personas, NOW(), 'Pendiente');
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_actualizar_reserva` (IN `p_id_reserva` INT, IN `p_id_lugar` INT, IN `p_fecha` DATE, IN `p_personas` INT, IN `p_estado` VARCHAR(20))   BEGIN
    DECLARE v_precio DECIMAL(10,2);
    DECLARE v_total DECIMAL(10,2);
    
    -- Obtener el nuevo precio si cambió el lugar
    SELECT precio_desde INTO v_precio 
    FROM lugares_turisticos 
    WHERE ID_Lugar = p_id_lugar;
    
    -- Calcular el nuevo total
    SET v_total = v_precio * p_personas;
    
    -- Actualizar la reserva
    UPDATE reservas 
    SET 
        ID_Lugar = p_id_lugar,
        Fecha = p_fecha,
        Personas = p_personas,
        Total = v_total,
        Estado = p_estado
    WHERE ID_Reserva = p_id_reserva;
    
    SELECT ROW_COUNT() AS filas_afectadas;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_cancelar_reserva` (IN `p_id_reserva` INT, IN `p_id_usuario` INT)   BEGIN
    DECLARE v_estado_actual VARCHAR(20);
    DECLARE v_fecha_reserva DATE;
    
    -- Obtener estado actual
    SELECT Estado, Fecha INTO v_estado_actual, v_fecha_reserva
    FROM reservas
    WHERE ID_Reserva = p_id_reserva AND ID_Usuario = p_id_usuario;
    
    -- Validar que exista la reserva
    IF v_estado_actual IS NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Reserva no encontrada o no pertenece al usuario';
    END IF;
    
    -- Validar que no esté ya cancelada
    IF v_estado_actual = 'Cancelada' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La reserva ya está cancelada';
    END IF;
    
    -- Validar fecha (no cancelar el mismo día)
    IF v_fecha_reserva = CURDATE() THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'No se puede cancelar una reserva el mismo día';
    END IF;
    
    -- Actualizar estado
    UPDATE reservas
    SET Estado = 'Cancelada'
    WHERE ID_Reserva = p_id_reserva;
    
    SELECT 'Reserva cancelada correctamente' AS Mensaje;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_crear_reserva` (IN `p_id_usuario` INT, IN `p_id_lugar` INT, IN `p_fecha` DATE, IN `p_personas` INT, IN `p_estado` VARCHAR(20))   BEGIN
    DECLARE v_precio DECIMAL(10,2);
    DECLARE v_total DECIMAL(10,2);

    -- Obtener el precio base del lugar
    SELECT precio_desde INTO v_precio
    FROM lugares_turisticos
    WHERE ID_Lugar = p_id_lugar;

    -- Calcular el total
    SET v_total = v_precio * p_personas;

    -- Insertar la reserva
    INSERT INTO reservas (ID_Usuario, ID_Lugar, Fecha, Personas, Total, Estado)
    VALUES (p_id_usuario, p_id_lugar, p_fecha, p_personas, v_total, p_estado);

    -- Retornar el ID de la nueva reserva
    SELECT LAST_INSERT_ID() AS nueva_reserva;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_eliminar_reserva` (IN `p_id_reserva` INT)   BEGIN
    -- Registrar en histórico antes de eliminar
    INSERT INTO reservas_historicos
    SELECT *, NOW() FROM reservas WHERE ID_Reserva = p_id_reserva;
    
    -- Eliminar la reserva
    DELETE FROM reservas WHERE ID_Reserva = p_id_reserva;
    
    SELECT ROW_COUNT() AS filas_afectadas;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_obtener_reserva` (IN `p_id_reserva` INT)   BEGIN
    SELECT 
        r.ID_Reserva,
        r.ID_Usuario,
        u.Nombre AS Usuario,
        r.ID_Lugar,
        l.Nombre AS Lugar,
        r.Fecha,
        r.Personas,
        r.Total,
        r.Estado,
        DATE_FORMAT(r.Fecha_Creacion, '%d/%m/%Y %H:%i') AS Fecha_Creacion
    FROM reservas r
    JOIN usuarios u ON r.ID_Usuario = u.ID_Usuario
    JOIN lugares_turisticos l ON r.ID_Lugar = l.ID_Lugar
    WHERE r.ID_Reserva = p_id_reserva;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_obtener_reservas_usuario` (IN `p_id_usuario` INT)   BEGIN
    -- Validar que el usuario existe
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE ID_Usuario = p_id_usuario) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usuario no encontrado';
    END IF;
    
    -- Obtener reservas activas
    SELECT * FROM vw_reservas_usuario 
    WHERE ID_Usuario = p_id_usuario AND Estado != 'Cancelada' AND Fecha >= CURDATE()
    ORDER BY Fecha DESC;
    
    -- Obtener historial de reservas (pasadas o canceladas)
    SELECT * FROM vw_reservas_usuario 
    WHERE ID_Usuario = p_id_usuario AND (Estado = 'Cancelada' OR Fecha < CURDATE())
    ORDER BY Fecha DESC
    LIMIT 20;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_reservas_por_usuario` (IN `p_id_usuario` INT)   BEGIN
    SELECT 
        r.ID_Reserva,
        l.Nombre AS Lugar,
        r.Fecha,
        r.Personas,
        r.Total,
        r.Estado,
        DATE_FORMAT(r.Fecha_Creacion, '%d/%m/%Y %H:%i') AS Fecha_Creacion
    FROM reservas r
    JOIN lugares_turisticos l ON r.ID_Lugar = l.ID_Lugar
    WHERE r.ID_Usuario = p_id_usuario
    ORDER BY r.Fecha DESC;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `auditoria`
--

CREATE TABLE `auditoria` (
  `id` int(11) NOT NULL,
  `tabla` varchar(100) DEFAULT NULL,
  `operacion` varchar(50) DEFAULT NULL,
  `fecha` datetime DEFAULT NULL,
  `descripcion` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `auditoria`
--

INSERT INTO `auditoria` (`id`, `tabla`, `operacion`, `fecha`, `descripcion`) VALUES
(1, 'usuarios', 'INSERT', '2025-05-30 02:43:45', 'Nuevo usuario ID 7 registrado: yamal'),
(2, 'servicios_turisticos', 'INSERT', '2025-05-30 09:06:13', 'Servicio creado: Hospedaje'),
(3, 'usuarios', 'INSERT', '2025-05-30 09:16:33', 'Nuevo usuario ID 8 registrado: adrian stiven murillo palacios'),
(4, 'usuarios', 'INSERT', '2025-05-30 19:57:22', 'Nuevo usuario ID 9 registrado: Samir Simmons'),
(5, 'usuarios', 'UPDATE', '2025-05-30 20:02:45', 'Usuario ID 9 actualizado. Rol:  → Guia'),
(6, 'reservas', 'INSERT', '2025-05-30 21:17:42', 'Reserva ID 1 registrada por el usuario ID 6'),
(7, 'reservas', 'INSERT', '2025-05-30 21:23:56', 'Reserva ID 2 registrada por el usuario ID 6'),
(8, 'reservas', 'INSERT', '2025-05-30 22:00:06', 'Reserva ID 3 registrada por el usuario ID 5'),
(9, 'reservas', 'INSERT', '2025-05-30 22:07:53', 'Reserva ID 4 registrada por el usuario ID 3'),
(10, 'reservas', 'INSERT', '2025-05-30 22:10:13', 'Reserva ID 5 registrada por el usuario ID 7'),
(11, 'reservas', 'UPDATE', '2025-05-30 22:10:31', 'Reserva ID 3 actualizada. Estado: Pendiente → Confirmada'),
(12, 'reservas', 'UPDATE', '2025-05-30 22:10:53', 'Reserva ID 2 actualizada. Estado: Pendiente → Cancelada'),
(13, 'servicios_turisticos', 'INSERT', '2025-05-30 22:53:29', 'Servicio creado: EcoGuía');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `evaluaciones`
--

CREATE TABLE `evaluaciones` (
  `ID_Evaluacion` int(11) NOT NULL,
  `ID_Reserva` int(11) DEFAULT NULL,
  `Calificacion` int(11) DEFAULT NULL CHECK (`Calificacion` between 1 and 5),
  `Comentario` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `lugares_turisticos`
--

CREATE TABLE `lugares_turisticos` (
  `ID_Lugar` int(11) NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `tipo` varchar(50) DEFAULT NULL,
  `Ubicacion` varchar(255) NOT NULL COMMENT 'Departamento, municipio y coordenadas',
  `Descripcion` text DEFAULT NULL,
  `Atracciones` text DEFAULT NULL COMMENT 'Actividades o puntos destacados',
  `Acceso` text DEFAULT NULL COMMENT 'Medios de transporte y rutas',
  `puntuacion` decimal(2,1) DEFAULT 0.0,
  `precio_desde` int(11) DEFAULT 0,
  `Temporada_Ideal` varchar(100) DEFAULT NULL,
  `Sostenibilidad` enum('Alta','Media','Baja') DEFAULT NULL,
  `Foto_Principal` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `lugares_turisticos`
--

INSERT INTO `lugares_turisticos` (`ID_Lugar`, `Nombre`, `tipo`, `Ubicacion`, `Descripcion`, `Atracciones`, `Acceso`, `puntuacion`, `precio_desde`, `Temporada_Ideal`, `Sostenibilidad`, `Foto_Principal`) VALUES
(1, 'Playas de Mecana', 'playa', 'Nuquí', 'A la que puedes llegar luego de una caminata por tierra de aproximadamente hora y media o 25 minutos en lancha.', NULL, 'Caminata o lancha', 4.5, 250000, NULL, NULL, 'Mecana.jpg'),
(2, 'Playita de Los Potes', 'playa', 'Bahía Solano', 'Ubicada a unos 30 minutos del centro de Bahía Solano, en cuyos alrededores encontrarás arenas grisáceas y aguas sumamente tranquilas.', NULL, 'Terrestre', 4.2, 180000, NULL, NULL, 'playita-potes.jpg'),
(3, 'Huina', 'caserio', 'Bahía Solano', 'Interesante caserío a tan solo unos 20 minutos en lancha, con hoteles, hospedajes y una playa de arena dorada y aguas cristalinas.', NULL, 'Lancha', 4.7, 320000, NULL, NULL, 'Huina-playa.jpg'),
(4, 'Playa El Almejal', 'playa', 'Juradó', 'Una de las playas más hermosas del Chocó, con arena blanca y aguas turquesas, ideal para relajarse y disfrutar del sol.', NULL, 'Lancha', 4.7, 150000, NULL, NULL, 'almejal.jpg'),
(5, 'Cascada de Nabuga', 'cascada', 'Bahía Solano', 'Maravilloso espectáculo de la naturaleza, con una caída de agua que se destaca por su trayectoria y finaliza en una amplia piscina.', NULL, 'Lancha', 4.8, 200000, NULL, NULL, 'cascada_nabuga.jpg'),
(6, 'Río de Mecanita', 'rio', 'Bahía Solano', 'Cuerpo de agua en el que se puede navegar en canoa y practicar deportes como la pesca.', NULL, 'Canoa', 4.3, 220000, NULL, NULL, 'rio-mecanita.jpg'),
(7, 'Parque Nacional Natural Utría', 'Reserva', 'Bahía Solano', 'Reserva natural que alberga una gran diversidad de flora y fauna, ideal para los amantes del ecoturismo.', NULL, 'Caminata', 4.7, 190000, NULL, NULL, 'Utria.jpg'),
(8, 'Playa Blanca', 'playa', 'Bahía Solano', 'Un rincón elegido por muchos turistas que buscan lo mejor de Bahía Solano.', NULL, 'Lancha', 4.6, 280000, NULL, NULL, 'Playa-Blanca.jpg'),
(9, 'Playas de Sapzurro', 'playa', 'Acandí', 'Una de las playas más hermosas del Chocó, con arena blanca y aguas turquesas, ideal para relajarse y disfrutar del sol.', NULL, 'Lancha', 4.8, 70000, NULL, NULL, 'Sapzurro.jpg'),
(10, 'Termales Jurubirá', 'Aguas Termales', 'Nuquí', 'Un lugar mágico donde puedes disfrutar de aguas termales naturales rodeadas de una exuberante vegetación.', NULL, 'Caminata', 4.5, 230000, NULL, NULL, 'Termales.jpg'),
(11, 'Cascada El Tigre', 'cascada', 'Bahía Solano', 'Muestra de la amplia diversidad de caídas de agua presentes en Bahía Solano, con aguas puras y cristalinas.', NULL, 'Caminata', 4.7, 240000, NULL, NULL, 'tigre.jpg'),
(12, 'Cascada Chadó', 'cascada', 'Nuquí', 'Hermosa cascada donde puedes sumergirte en sus aguas puras y cristalinas.', NULL, 'Caminata', 4.5, 260000, NULL, NULL, 'Chadó.jpg'),
(13, 'Playa La Miel', 'playa', 'Capurganá', 'Una de las playas más hermosas del Chocó, con arena blanca y aguas turquesas.', NULL, 'Lancha', 4.8, 300000, NULL, NULL, 'Miel.jpg'),
(14, 'Cascada El Cielo', 'cascada', 'Capurganá', 'Una impresionante cascada que cae desde una gran altura, rodeada de vegetación exuberante.', NULL, 'Caminata', 4.6, 270000, NULL, NULL, 'cielo.jpg');

--
-- Disparadores `lugares_turisticos`
--
DELIMITER $$
CREATE TRIGGER `trg_delete_lugar` AFTER DELETE ON `lugares_turisticos` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'lugares_turisticos',
        'DELETE',
        NOW(),
        CONCAT('Lugar eliminado: ', OLD.Nombre)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_insert_lugar` AFTER INSERT ON `lugares_turisticos` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'lugares_turisticos',
        'INSERT',
        NOW(),
        CONCAT('Lugar turístico agregado: ', NEW.Nombre)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_update_lugar` AFTER UPDATE ON `lugares_turisticos` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'lugares_turisticos',
        'UPDATE',
        NOW(),
        CONCAT('Lugar ID ', NEW.ID_Lugar, ' actualizado. Nombre: ', OLD.Nombre, ' → ', NEW.Nombre)
    );
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `reservas`
--

CREATE TABLE `reservas` (
  `ID_Reserva` int(11) NOT NULL,
  `ID_Usuario` int(11) DEFAULT NULL,
  `ID_Servicio` int(11) DEFAULT NULL,
  `Fecha` date NOT NULL,
  `Personas` int(11) NOT NULL,
  `Estado` enum('Pendiente','Confirmada','Cancelada') DEFAULT NULL,
  `Total` decimal(10,2) NOT NULL,
  `ID_Lugar` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `reservas`
--

INSERT INTO `reservas` (`ID_Reserva`, `ID_Usuario`, `ID_Servicio`, `Fecha`, `Personas`, `Estado`, `Total`, `ID_Lugar`) VALUES
(1, 6, NULL, '2025-07-03', 2, 'Pendiente', 0.00, 13),
(2, 6, NULL, '2025-07-03', 3, 'Cancelada', 450000.00, 4),
(3, 5, NULL, '2025-06-07', 5, 'Confirmada', 1600000.00, 3),
(4, 3, NULL, '2025-06-22', 3, 'Pendiente', 900000.00, 13),
(5, 7, NULL, '2025-06-06', 1, 'Confirmada', 260000.00, 12);

--
-- Disparadores `reservas`
--
DELIMITER $$
CREATE TRIGGER `tr_auditoria_reservas` AFTER UPDATE ON `reservas` FOR EACH ROW BEGIN
    IF OLD.Estado != NEW.Estado OR OLD.Fecha != NEW.Fecha OR OLD.Personas != NEW.Personas THEN
        INSERT INTO auditoria_reservas (
            ID_Reserva,
            Campo_Modificado,
            Valor_Anterior,
            Valor_Nuevo,
            Fecha_Cambio,
            ID_Usuario
        ) VALUES (
            NEW.ID_Reserva,
            CASE 
                WHEN OLD.Estado != NEW.Estado THEN 'Estado'
                WHEN OLD.Fecha != NEW.Fecha THEN 'Fecha'
                WHEN OLD.Personas != NEW.Personas THEN 'Personas'
            END,
            CASE 
                WHEN OLD.Estado != NEW.Estado THEN OLD.Estado
                WHEN OLD.Fecha != NEW.Fecha THEN OLD.Fecha
                WHEN OLD.Personas != NEW.Personas THEN OLD.Personas
            END,
            CASE 
                WHEN OLD.Estado != NEW.Estado THEN NEW.Estado
                WHEN OLD.Fecha != NEW.Fecha THEN NEW.Fecha
                WHEN OLD.Personas != NEW.Personas THEN NEW.Personas
            END,
            NOW(),
            NEW.ID_Usuario
        );
    END IF;
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `tr_validar_disponibilidad_reserva` BEFORE INSERT ON `reservas` FOR EACH ROW BEGIN
    DECLARE v_capacidad INT;
    DECLARE v_reservas_existentes INT;
    
    -- Obtener capacidad del lugar
    SELECT Capacidad INTO v_capacidad
    FROM lugares_turisticos
    WHERE ID_Lugar = NEW.ID_Lugar;
    
    -- Contar reservas existentes para esa fecha
    SELECT SUM(Personas) INTO v_reservas_existentes
    FROM reservas
    WHERE ID_Lugar = NEW.ID_Lugar AND Fecha = NEW.Fecha;
    
    -- Validar disponibilidad
    IF (v_reservas_existentes + NEW.Personas) > v_capacidad THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'No hay disponibilidad para la cantidad de personas solicitada en esta fecha';
    END IF;
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_delete_reserva` AFTER DELETE ON `reservas` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'reservas',
        'DELETE',
        NOW(),
        CONCAT('Reserva ID ', OLD.ID_Reserva, ' eliminada por el usuario ID ', OLD.ID_Usuario)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_estado_auto` BEFORE INSERT ON `reservas` FOR EACH ROW BEGIN
    IF NEW.Personas = 1 THEN
        SET NEW.Estado = 'Confirmada';
    ELSE
        SET NEW.Estado = 'Pendiente';
    END IF;
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_insert_reserva` AFTER INSERT ON `reservas` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'reservas',
        'INSERT',
        NOW(),
        CONCAT('Reserva ID ', NEW.ID_Reserva, ' registrada por el usuario ID ', NEW.ID_Usuario)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_update_reserva` AFTER UPDATE ON `reservas` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'reservas',
        'UPDATE',
        NOW(),
        CONCAT('Reserva ID ', NEW.ID_Reserva, ' actualizada. Estado: ', OLD.Estado, ' → ', NEW.Estado)
    );
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `rutas`
--

CREATE TABLE `rutas` (
  `ID_Ruta` int(11) NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `Duracion` varchar(50) DEFAULT NULL COMMENT 'Tiempo estimado',
  `Dificultad` enum('Baja','Media','Alta') DEFAULT NULL,
  `Puntos_Interes` text DEFAULT NULL,
  `Recomendaciones` text DEFAULT NULL,
  `ID_Lugar` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `servicios_turisticos`
--

CREATE TABLE `servicios_turisticos` (
  `ID_Servicio` int(11) NOT NULL,
  `Tipo` enum('Hospedaje','Alimentación','Guía','Transporte','Tour') NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `Proveedor` varchar(100) NOT NULL,
  `Contacto` varchar(255) DEFAULT NULL COMMENT 'Teléfono, correo o redes sociales',
  `Costo` decimal(10,2) DEFAULT NULL COMMENT 'Precio en COP',
  `Sostenibilidad` text DEFAULT NULL COMMENT 'Prácticas ecológicas',
  `ID_Lugar` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `servicios_turisticos`
--

INSERT INTO `servicios_turisticos` (`ID_Servicio`, `Tipo`, `Nombre`, `Proveedor`, `Contacto`, `Costo`, `Sostenibilidad`, `ID_Lugar`) VALUES
(1, 'Hospedaje', 'EcoHotel Bahía Solano', 'Alex', 'eco@hotel.com / 3111234567', 180000.00, 'Uso de energía solar, reciclaje de agua', NULL),
(2, 'Tour', 'Avistamiento de Ballenas - Nuquí', 'Alex', 'toursnuqui@gmail.com / 3107654321', 95000.00, 'Guías certificados, control de residuos', NULL),
(3, 'Hospedaje', 'EcoHotel Bahía Solano', 'Yoisi', 'Alex', 180000.00, 'Uso de energía solar, reciclaje de agua', NULL),
(4, 'Hospedaje', 'Hospedaje', 'Yoisi', 'Alex-3186910528', 150000.00, 'Paneles solares', NULL),
(5, 'Guía', 'EcoGuía', 'Yoisi', 'Samir', 75000.00, '', NULL);

--
-- Disparadores `servicios_turisticos`
--
DELIMITER $$
CREATE TRIGGER `trg_insert_servicio` AFTER INSERT ON `servicios_turisticos` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'servicios_turisticos',
        'INSERT',
        NOW(),
        CONCAT('Servicio creado: ', NEW.nombre)
    );
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `ID_Usuario` int(11) NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `Email` varchar(100) NOT NULL,
  `Contrasena` varchar(255) NOT NULL,
  `Rol` enum('Turista','Empresario','Administrador','Gobierno','Guia') NOT NULL,
  `Fecha_Registro` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`ID_Usuario`, `Nombre`, `Email`, `Contrasena`, `Rol`, `Fecha_Registro`) VALUES
(1, 'Alex', 'alex10moya@gmail.com', '$2y$10$jH1rNGM63ik8t8pkOrr99OWt9xXneihdtxyjHFDFIdYbGichzDpB.', 'Administrador', '2025-05-16 02:40:15'),
(2, 'Yoisi', 'yoisi@gmail.com', '$2y$10$maZn8uuhrmtb/tyTk5CijeYXj646fhD7xFf4yd1ZgFKm18/ot68dK', 'Empresario', '2025-05-16 03:11:52'),
(3, 'Chala', 'chala@gmail.com', '$2y$10$b9Cq0JUayZMloXrkqag4H.DSrW5GS8DmxPL8PUeMdDY3Rg.YoBuf.', 'Turista', '2025-05-16 03:17:22'),
(4, 'Gabriela Córdoba', 'Gabriela@gmail.com', '$2y$10$yWXVgaOKtoqxauA1mEdgXuTkVdU52n/d425W25DJpEZ0p3SatmtzC', 'Gobierno', '2025-05-16 03:26:29'),
(5, 'Mbappe', 'mbbape@gmail.com', '$2y$10$8agqLn1hsJ6jxKcfgWdvI.0AwCfgBxntJToMO89Alw496mJBIByMm', 'Turista', '2025-05-16 04:28:11'),
(6, 'Witner', 'witner@gmail.com', '$2y$10$Kw2YNqQuDIngHmUmPhm5COIJi0ICAWE2VJXXZLwTo4TIjHral4LBm', 'Turista', '2025-05-30 00:05:03'),
(7, 'yamal', 'yamal@gmail.com', '$2y$10$E8TfcGQ5142TFaekJpPB0uICkvMw7xN5gC.Wf0cpi6PWb6l9gmQB2', 'Turista', '2025-05-30 07:43:45'),
(8, 'adrian stiven murillo palacios', 'adrianstivenpm@gmail.com', '$2y$10$runHNwjZlDmxZSjPgjmMWe6mBzBbYnXV883Gl8YLZ6Pne3D0T2jhe', 'Empresario', '2025-05-30 14:16:33'),
(9, 'Samir Simmons', 'samir@gmail.com', '$2y$10$rNCjL2dKWrH3V3FiEdcUCeIC6dPqbWOS9H1WL3yAJUR3sIOJC5GZ.', 'Guia', '2025-05-31 00:57:22');

--
-- Disparadores `usuarios`
--
DELIMITER $$
CREATE TRIGGER `trg_delete_usuario` AFTER DELETE ON `usuarios` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'usuarios',
        'DELETE',
        NOW(),
        CONCAT('Usuario ID ', OLD.id_usuario, ' eliminado: ', OLD.nombre)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_insert_usuario` AFTER INSERT ON `usuarios` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'usuarios',
        'INSERT',
        NOW(),
        CONCAT('Nuevo usuario ID ', NEW.id_usuario, ' registrado: ', NEW.nombre)
    );
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_update_usuario` AFTER UPDATE ON `usuarios` FOR EACH ROW BEGIN
    INSERT INTO auditoria (tabla, operacion, fecha, descripcion)
    VALUES (
        'usuarios',
        'UPDATE',
        NOW(),
        CONCAT('Usuario ID ', NEW.id_usuario, ' actualizado. Rol: ', OLD.rol, ' → ', NEW.rol)
    );
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Estructura Stand-in para la vista `vw_reservas_usuario`
-- (Véase abajo para la vista actual)
--
CREATE TABLE `vw_reservas_usuario` (
`ID_Reserva` int(11)
,`ID_Usuario` int(11)
,`ID_Lugar` int(11)
,`Lugar` varchar(100)
,`Fecha` date
,`Personas` int(11)
,`Total` decimal(10,2)
,`Estado` enum('Pendiente','Confirmada','Cancelada')
,`TipoReserva` varchar(7)
,`FechaFormateada` varchar(10)
,`FechaReservaFormateada` varchar(21)
);

-- --------------------------------------------------------

--
-- Estructura para la vista `vw_reservas_usuario`
--
DROP TABLE IF EXISTS `vw_reservas_usuario`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vw_reservas_usuario`  AS SELECT `r`.`ID_Reserva` AS `ID_Reserva`, `r`.`ID_Usuario` AS `ID_Usuario`, `r`.`ID_Lugar` AS `ID_Lugar`, `l`.`Nombre` AS `Lugar`, `r`.`Fecha` AS `Fecha`, `r`.`Personas` AS `Personas`, `r`.`Total` AS `Total`, `r`.`Estado` AS `Estado`, CASE WHEN `r`.`Fecha` > curdate() THEN 'Próxima' WHEN `r`.`Fecha` = curdate() THEN 'Hoy' ELSE 'Pasada' END AS `TipoReserva`, date_format(`r`.`Fecha`,'%d/%m/%Y') AS `FechaFormateada`, date_format(`r`.`Fecha`,'%d/%m/%Y %H:%i') AS `FechaReservaFormateada` FROM (`reservas` `r` join `lugares_turisticos` `l` on(`r`.`ID_Lugar` = `l`.`ID_Lugar`)) ;

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `auditoria`
--
ALTER TABLE `auditoria`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `evaluaciones`
--
ALTER TABLE `evaluaciones`
  ADD PRIMARY KEY (`ID_Evaluacion`),
  ADD KEY `ID_Reserva` (`ID_Reserva`);

--
-- Indices de la tabla `lugares_turisticos`
--
ALTER TABLE `lugares_turisticos`
  ADD PRIMARY KEY (`ID_Lugar`);

--
-- Indices de la tabla `reservas`
--
ALTER TABLE `reservas`
  ADD PRIMARY KEY (`ID_Reserva`),
  ADD KEY `ID_Usuario` (`ID_Usuario`),
  ADD KEY `ID_Servicio` (`ID_Servicio`),
  ADD KEY `fk_reservas_lugar` (`ID_Lugar`);

--
-- Indices de la tabla `rutas`
--
ALTER TABLE `rutas`
  ADD PRIMARY KEY (`ID_Ruta`),
  ADD KEY `ID_Lugar` (`ID_Lugar`);

--
-- Indices de la tabla `servicios_turisticos`
--
ALTER TABLE `servicios_turisticos`
  ADD PRIMARY KEY (`ID_Servicio`),
  ADD KEY `ID_Lugar` (`ID_Lugar`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`ID_Usuario`),
  ADD UNIQUE KEY `Email` (`Email`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `auditoria`
--
ALTER TABLE `auditoria`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT de la tabla `evaluaciones`
--
ALTER TABLE `evaluaciones`
  MODIFY `ID_Evaluacion` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `lugares_turisticos`
--
ALTER TABLE `lugares_turisticos`
  MODIFY `ID_Lugar` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT de la tabla `reservas`
--
ALTER TABLE `reservas`
  MODIFY `ID_Reserva` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT de la tabla `rutas`
--
ALTER TABLE `rutas`
  MODIFY `ID_Ruta` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `servicios_turisticos`
--
ALTER TABLE `servicios_turisticos`
  MODIFY `ID_Servicio` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `ID_Usuario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `evaluaciones`
--
ALTER TABLE `evaluaciones`
  ADD CONSTRAINT `evaluaciones_ibfk_1` FOREIGN KEY (`ID_Reserva`) REFERENCES `reservas` (`ID_Reserva`);

--
-- Filtros para la tabla `reservas`
--
ALTER TABLE `reservas`
  ADD CONSTRAINT `fk_reservas_lugar` FOREIGN KEY (`ID_Lugar`) REFERENCES `lugares_turisticos` (`ID_Lugar`),
  ADD CONSTRAINT `reservas_ibfk_1` FOREIGN KEY (`ID_Usuario`) REFERENCES `usuarios` (`ID_Usuario`),
  ADD CONSTRAINT `reservas_ibfk_2` FOREIGN KEY (`ID_Servicio`) REFERENCES `servicios_turisticos` (`ID_Servicio`);

--
-- Filtros para la tabla `rutas`
--
ALTER TABLE `rutas`
  ADD CONSTRAINT `rutas_ibfk_1` FOREIGN KEY (`ID_Lugar`) REFERENCES `lugares_turisticos` (`ID_Lugar`);

--
-- Filtros para la tabla `servicios_turisticos`
--
ALTER TABLE `servicios_turisticos`
  ADD CONSTRAINT `servicios_turisticos_ibfk_1` FOREIGN KEY (`ID_Lugar`) REFERENCES `lugares_turisticos` (`ID_Lugar`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
