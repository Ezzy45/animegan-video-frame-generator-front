CREATE DATABASE IF NOT EXISTS vaguetv
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE vaguetv;

-- ------------------------------------------------------------
-- Table : users (Mise à jour : email et password optionnels)
-- ------------------------------------------------------------
CREATE TABLE users (
    id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    email         VARCHAR(255)      NULL DEFAULT NULL UNIQUE, -- 🆕 NULL par défaut pour les sessions locales
    password      VARCHAR(255)      NULL DEFAULT NULL COMMENT 'bcrypt hash', -- 🆕 NULL pour les sessions locales
    google_id     VARCHAR(255)      NULL DEFAULT NULL UNIQUE, -- 🆕 Ajouté pour correspondre à ton backend Google Auth
    avatar_url    TEXT              NULL,                     -- 🆕 Ajouté pour correspondre à ton backend
    is_premium    TINYINT(1)        NOT NULL DEFAULT 0,
    created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table : channels (Inchangée et optimisée)
-- ------------------------------------------------------------
CREATE TABLE channels (
    id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    name              VARCHAR(255)      NOT NULL,
    category          VARCHAR(100)      NOT NULL COMMENT 'ex: Sports, News, Adult, Music…',
    stream_url        TEXT              NOT NULL COMMENT 'URL HLS/M3U8 chiffrée ou signée',
    thumbnail_url     TEXT              NULL,
    is_premium_only   TINYINT(1)        NOT NULL DEFAULT 0 COMMENT '1 = réservé aux abonnés premium',
    is_safe_for_store TINYINT(1)        NOT NULL DEFAULT 1 COMMENT '0 = contenu 18+, exclu de la version Store',
    is_active         TINYINT(1)        NOT NULL DEFAULT 1,
    sort_order        INT               NOT NULL DEFAULT 0,
    created_at        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_channels_category         (category),
    INDEX idx_channels_safe_for_store   (is_safe_for_store),
    INDEX idx_channels_premium          (is_premium_only),
    INDEX idx_channels_active           (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table : subscriptions
-- ------------------------------------------------------------
CREATE TABLE subscriptions (
    id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED   NOT NULL,
    plan            VARCHAR(50)       NOT NULL DEFAULT 'monthly' COMMENT 'monthly | yearly | lifetime',
    started_at      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      DATETIME          NULL     COMMENT 'NULL = lifetime',
    payment_ref     VARCHAR(255)       NULL     COMMENT 'référence paiement externe',
    PRIMARY KEY (id),
    CONSTRAINT fk_subscriptions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_subs_user (user_id),
    INDEX idx_subs_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Données de démo
-- ------------------------------------------------------------
INSERT INTO channels
    (name, category, stream_url, thumbnail_url, is_premium_only, is_safe_for_store, sort_order)
VALUES
    ('RTG Guinée',     'News',    'https://stream.example.com/rtg.m3u8',    NULL, 0, 1, 1),
    ('Canal+ Sport',   'Sports',  'https://stream.example.com/sport.m3u8',  NULL, 1, 1, 2),
    ('Hits Afrique',   'Music',   'https://stream.example.com/hits.m3u8',   NULL, 0, 1, 3),
    ('Chaîne VIP 1',   'Premium', 'https://stream.example.com/vip1.m3u8',   NULL, 1, 1, 4),
    ('AdultChannel 1', 'Adult',   'https://stream.example.com/adult1.m3u8', NULL, 0, 0, 5),
    ('AdultChannel 2', 'Adult',   'https://stream.example.com/adult2.m3u8', NULL, 1, 0, 6);
