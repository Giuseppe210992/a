CREATE TABLE `checkinGuests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checkinId` int NOT NULL,
	`guestId` int NOT NULL,
	`guestOrder` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `checkinGuests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checkins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hotelId` int NOT NULL,
	`mainGuestId` int NOT NULL,
	`checkInDate` timestamp NOT NULL DEFAULT (now()),
	`checkOutDate` timestamp,
	`roomNumber` varchar(10),
	`numberOfGuests` int DEFAULT 1,
	`amount` decimal(10,2),
	`currency` varchar(3) DEFAULT 'EUR',
	`bookingReference` varchar(100),
	`status` enum('pending','completed','cancelled') DEFAULT 'pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `checkins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checkinId` int NOT NULL,
	`documentType` enum('receipt_pdf','ross1000','alloggiati_xml'),
	`documentUrl` varchar(500),
	`documentKey` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`dateOfBirth` varchar(10),
	`documentType` enum('id_card','passport','driving_license') NOT NULL,
	`documentNumber` varchar(50) NOT NULL,
	`gender` enum('M','F','O'),
	`citizenship` varchar(100),
	`documentImageUrl` varchar(500),
	`documentImageKey` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hotels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text,
	`city` varchar(100),
	`province` varchar(2),
	`postalCode` varchar(10),
	`phone` varchar(20),
	`email` varchar(320),
	`adminUserId` int NOT NULL,
	`wsKeyAlloggiati` varchar(255),
	`rossCode` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hotels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hotelId` int NOT NULL,
	`checkinId` int NOT NULL,
	`recipientUserId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text,
	`sent` boolean DEFAULT false,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checkinId` int NOT NULL,
	`guestId` int NOT NULL,
	`signatureImageUrl` varchar(500),
	`signatureImageKey` varchar(255),
	`gdprConsent` boolean DEFAULT true,
	`consentTimestamp` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signatures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `hotelId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `userRole` enum('admin_hotel','operator') DEFAULT 'operator';