import { constructStream } from "./src/streamConstructor";
import { Config } from "./models/config";
import * as VLC from "vlc-client"
import { loadMedia } from "./dataAccess/dataManager";
import { Media } from "./models/media";
import { execSync } from 'child_process';
import * as fs from 'fs';

import { StreamArgs } from "./models/streamArgs";
import { LoadMediaArgs } from "./models/loadMediaArgs";
import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { MediaBlock } from "./models/mediaBlock";

const config: Config = require('./config.json') as Config;
const app = express();
const port = process.env.PORT || 3000;

const streamAllowedFields = ['env', 'movies', 'tagsOR', 'endTime', 'startTime', 'password'];
const loadMediaAllowedFields = ['password', 'media'];
let upcomingStream: MediaBlock[] = [];
let onDeckStream: MediaBlock[] = [];

const streamStartValidationRules = [
	// Ensure only allowed fields are present
	(req: Request, res: Response, next: Function) => {
		const requestBody: Record<string, any> = req.body;

		const extraFields = Object.keys(requestBody).filter((field) => !streamAllowedFields.includes(field));
		if (extraFields.length > 0) {
			return res.status(400).json({ error: `Invalid fields: ${extraFields.join(', ')}` });
		}
		next();
	},

	// Validate the 'env' field
	body('env')
		.optional()
		.custom((value: string) => {
			if (value !== 'Default' && value !== 'FC') {
				throw new Error("Env must be values 'Default' or 'FC'");
			}
			return true;
		}),

	// Validate the 'movies' field
	body('movies')
		.optional()
		.isArray()
		.custom((value: string[]) => {
			for (const item of value) {
				if (typeof item !== 'string') {
					throw new Error('movies must be an array of strings');
				}
				console.log("Movie being checked: " + item);
				if (item.includes('::')) {
					console.log("Movie being spliced: " + item);
					const [firstPart, secondPart] = item.split('::');
					// Check the first part for only letters and numbers
					if (!/^[a-zA-Z0-9]+$/.test(firstPart)) {
						throw new Error('The first part of movies must contain only letters and numbers');
					}

					// Check the second part for ISO 8601 date format with 30-minute increments
					const isoDateRegex = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30))$/;
					if (!isoDateRegex.test(secondPart)) {
						throw new Error('The second part of movies must be in the format YYYY-MM-DDTHH:MM with 30-minute increments in 24-hour time');
					}
				} else {
					// If no "::" found, check for only letters and numbers
					if (!/^[a-zA-Z0-9]+$/.test(item)) {
						throw new Error('movies must be in the format "string" or "string::ISO8601 date" with allowed characters');
					}
				}
			}
			return true;
		}),

	// Validate the 'tagsOR' field
	body('tagsOR')
		.optional()
		.isArray()
		.withMessage('tagsOR must be an array')
		.custom((value: string[]) => {
			// Check if all elements in the array are strings
			for (const item of value) {
				if (typeof item !== 'string') {
					throw new Error('tagsOR must be an array of strings');
				}
			}
			return true;
		}),

	// Validate the 'endTime' field
	body('endTime')
		.optional()
		.custom((value: string) => {
			// Use a regular expression to match the desired format (YYYY-MM-DDTHH:MM)
			const regex = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30)$/


			if (!regex.test(value)) {
				throw new Error('endTime must be in the format YYYY-MM-DDTHH:MM in 24-hour time and a multiple of 30 minutes');
			}

			return true;
		}),

	// Validate the 'startTime' field
	body('startTime')
		.optional()
		.custom((value: string) => {
			// Use a regular expression to match the desired format (YYYY-MM-DDTHH:MM)
			const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

			if (!regex.test(value)) {
				throw new Error('startTime must be in the format YYYY-MM-DDTHH:MM');
			}

			return true;
		}),

	// Validate the 'password' field
	body('password')
		.isString()
];

const loadMediaValidationRules = [
	// Ensure only allowed fields are present
	(req: Request, res: Response, next: Function) => {
		const requestBody: Record<string, any> = req.body;

		const extraFields = Object.keys(requestBody).filter((field) => !loadMediaAllowedFields.includes(field));
		if (extraFields.length > 0) {
			return res.status(400).json({ error: `Invalid fields: ${extraFields.join(', ')}` });
		}
		next();
	},

	// Validate the 'media' field
	body('media')
		.isArray()
		.custom((value: string[]) => {
			for (const item of value) {
				if (typeof item !== 'string') {
					throw new Error('media must be an array of strings');
				}
			}
			return true;
		}),

	// Validate the 'password' field
	body('password')
		.isString()
];

app.use(express.json());

app.post('/api/startStream', streamStartValidationRules, async (req: Request, res: Response) => {
	// Check for validation errors
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ errors: errors.array() });
	}

	let args: StreamArgs = mapStreamStartRequestToInputArgs(req);

	let currentProcesses = listRunningProcesses();
	let vlcIsActive = isVLCRunning(currentProcesses);
	if (!vlcIsActive) {
		execSync("start vlc");
		await delay(2);
	}



	const media: Media = loadMedia(config);

	let stream: MediaBlock[] = constructStream(config, args, media);
	// // convert stream to m3u file
	// createM3UFile(stream[0], config.destinationFolder, config.playlistName);
	// // execute stream
	// executeStream(config.vlcLocation, config.destinationFolder, config.playlistName);

	const vlc = new VLC.Client({
		ip: "localhost",
		port: 8080,
		username: "",
		password: args.password
	});

	for (const item of stream) {
		try {
			//If item has a initial Buffer, add it to the playlist
			if (item.InitialBuffer != null || item.InitialBuffer != undefined) {
				item.InitialBuffer.forEach(async (element) => {
					await vlc.addToPlaylist(element.Path);
				});
			}
			if (item.MainBlock?.Path != null || item.MainBlock?.Path != undefined) {
				await vlc.addToPlaylist(item.MainBlock.Path)
			}
			item.Buffer.forEach(async (element) => {
				await vlc.addToPlaylist(element.Path);
			});
		} catch (error) {
			console.error("An error occurred when adding to Playlist:", error);
		}
	}

	try {
		await vlc.next();
	} catch (error) {
		console.error("An error occurred when playing stream:", error);
	}

	// create json file with stream and write it to the destination folder
	fs.writeFileSync(config.destinationFolder + "output.json", JSON.stringify(stream));

	res.status(200).json({ message: stream });
});

app.get('/', (req: Request, res: Response) => {
	res.json({ message: 'Welcome to your API!' });
});

app.post('/api/loadMedia', loadMediaValidationRules, async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ errors: errors.array() });
	}
	let args: LoadMediaArgs = new LoadMediaArgs(req.body.password, req.body.media);

	let currentProcesses = listRunningProcesses();
	let vlcIsActive = isVLCRunning(currentProcesses);
	if (!vlcIsActive) {
		execSync("start vlc")
	}

	const vlc = new VLC.Client({
		ip: "localhost",
		port: 8080,
		username: "", // username is optional
		password: args.password
	});

	for (const item of args.media) {
		try {
			// Your asynchronous code logic goes here
			await vlc.addToPlaylist(item);
		} catch (error) {
			console.error("An error occurred:", error);
		}
	}

	// After all items are processed, you can send a response or perform other actions.
	res.status(200).json({ message: 'Media added to playlist successfully' });
});

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});

function convertISOToUnix(isoDateTime: string): number {
	// Convert ISO 8601 date-time to Unix timestamp in seconds
	return Math.floor(new Date(isoDateTime).getTime() / 1000);
}

export function mapStreamStartRequestToInputArgs(req: Request): StreamArgs {
	const { env, movies, tagsOR, endTime, startTime } = req.body;
	const inputArgs: StreamArgs = new StreamArgs(req.body.password);
	// Map env directly
	if (env) {
		inputArgs.env = env;
	}

	// Map tagsOR directly
	if (tagsOR) {
		inputArgs.tagsOR = tagsOR;
	}

	// Convert and map endTime and startTime to Unix timestamps
	if (endTime) {
		inputArgs.endTime = convertISOToUnix(endTime);
	}
	if (startTime) {
		inputArgs.startTime = convertISOToUnix(startTime);
	}

	// Map movies with date conversion
	if (movies && Array.isArray(movies)) {
		inputArgs.movies = movies.map((movie) => {
			const [firstPart, secondPart] = movie.split('::');
			if (secondPart) {
				// If "::" delimiter exists, convert the second part (ISO date) to Unix timestamp
				const unixTimestamp = convertISOToUnix(secondPart);
				// Rejoin the parts with "::" and the Unix timestamp
				return `${firstPart}::${unixTimestamp}`;
			} else {
				// No "::" delimiter, pass through the original string
				return movie;
			}
		});
	}

	return inputArgs;
}

function getCurrentUnixTimestamp() {
	return Math.floor(Date.now() / 1000); // Convert milliseconds to seconds
}

// Function to calculate the delay until the next interval mark
function calculateDelayToNextInterval(intervalInSeconds: number) {
	const now = new Date();
	const currentSeconds = now.getSeconds();
	const secondsToNextInterval = intervalInSeconds - (currentSeconds % intervalInSeconds);
	return secondsToNextInterval * 1000; // Convert seconds to milliseconds
}

// Initial delay until the next interval mark in seconds
const intervalInSeconds: number = 1800;
const initialDelay = calculateDelayToNextInterval(intervalInSeconds);

// Function to perform the check and set the next interval
function cycleCheck() {
	const currentUnixTimestamp = getCurrentUnixTimestamp();
	console.log(`Current Unix Timestamp: ${currentUnixTimestamp}`);

	// Calculate the delay until the next interval mark and set it as the new interval
	const nextDelay = calculateDelayToNextInterval(intervalInSeconds);
	setTimeout(cycleCheck, nextDelay);
}

// Start the initial check after the calculated delay
setTimeout(cycleCheck, initialDelay);

function listRunningProcesses(): string[] {
	try {
		const stdout = execSync('tasklist', { encoding: 'utf-8' });
		const processesList = stdout
			.split('\n')
			.filter((line) => line.trim() !== '') // Remove empty lines
			.map((line) => line.trim()); // Trim whitespace

		return processesList;
	} catch (error: any) {
		console.error('Error:', error.message);
		return [];
	}
}

function isVLCRunning(processesList: string[]): boolean {
	for (const processInfo of processesList) {
		if (processInfo.toLowerCase().includes('vlc.exe')) {
			return true;
		}
	}
	return false;
}

async function delay(seconds: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, seconds * 1000); // Convert seconds to milliseconds
	});
}
