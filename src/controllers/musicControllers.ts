import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { MusicModel, Music } from '../models/music';
import { LoadTitleError } from '../models/loadTitleError';
import { getMediaDuration, createMediaValidation } from './common';

// ===========================================
//               MUSIC HANDLERS
// ===========================================

export async function createMusicHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    let loadTitle = req.body.title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // Retrieve music from MongoDB using music load title if it exists
    const music = await MusicModel.findOne({ LoadTitle: loadTitle });

    // If it exists, return error
    if (music) {
        res.status(400).json({ message: "Music already exists" });
        return;
    }
    // If it doesn't exist, perform transformations
    let transformedComm = await transformMusicFromRequest(req.body, loadTitle);

    // Insert music into MongoDB
    await MusicModel.create(transformedComm);

    res.status(200).json({ message: "Music Created" });
    return;
}

export async function bulkCreateMusicHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    // Validate request body is an array
    if (!Array.isArray(req.body)) {
        res.status(400).json({ message: "Request body must be an array" });
        return;
    }
    // Validate request body is an array of objects
    if (!req.body.every((item: any) => typeof item === 'object')) {
        res.status(400).json({ message: "Request body must be an array of music objects" });
        return;
    }
    let createdMusic: string[] = [];
    let responseErrors: LoadTitleError[] = [];
    for (const musicEntry of req.body) {
        let err = createMediaValidation(musicEntry);
        if (err !== '') {
            responseErrors.push(new LoadTitleError(musicEntry.loadTitle, err));
            continue;
        }
        try {
            let loadTitle = musicEntry.title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const music = await MusicModel.findOne({ LoadTitle: loadTitle });
            if (music) {
                // If it exists, return error
                responseErrors.push(new LoadTitleError(musicEntry.title, `Music ${musicEntry.loadTitle} already exists`));
                continue;
            }

            let transformedComm = await transformMusicFromRequest(musicEntry, loadTitle);

            await MusicModel.create(transformedComm);
            createdMusic.push(transformedComm.LoadTitle);
        } catch (err) {
            responseErrors.push(new LoadTitleError(musicEntry.loadTitle, err as string));
        }
    }

    if (responseErrors.length === req.body.length) {
        res.status(400).json({ message: "Music Not Created", createdMusic: [], errors: responseErrors });
        return;
    }

    res.status(200).json({ message: "Music Created", createdMusic: createdMusic, errors: responseErrors });
    return;
}

export async function deleteMusicHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve music from MongoDB using music load title if it exists
    const music = await MusicModel.findOne({ LoadTitle: req.query.loadTitle });

    // If it doesn't exist, return error
    if (!music) {
        res.status(400).json({ message: "Music does not exist" });
        return;
    }

    // If it exists, delete it
    await MusicModel.deleteOne({ _id: music._id });

    res.status(200).json({ message: "Music Deleted" });
    return;
}

export async function updateMusicHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve music from MongoDB using music load title if it exists
    const music = await MusicModel.findOne({ Path: req.body.path });

    // If it doesn't exist, return error
    if (!music) {
        res.status(400).json({ message: "Music does not exist" });
        return;
    }

    // If it exists, perform transformations
    let updatedMusic = await transformMusicFromRequest(req.body, music.LoadTitle);

    // Update music in MongoDB
    await MusicModel.updateOne({ _id: music._id }, updatedMusic);

    res.status(200).json({ message: "Music Updated" });
    return;
}

export async function getMusicHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve music from MongoDB using music load title if it exists using request params
    const music = await MusicModel.findOne({ LoadTitle: req.query.loadTitle });

    // If it doesn't exist, return error
    if (!music) {
        res.status(404).json({ message: "Music does not exist" });
        return;
    }

    res.status(200).json(music);
    return;
}

export async function getAllMusicHandler(req: Request, res: Response): Promise<void> {
    const music = await MusicModel.find({});

    if (!music || music.length === 0) {
        res.status(404).json({ message: "No Music Found" });
        return;
    }
    res.status(200).json(music);
    return;
}

export async function transformMusicFromRequest(music: any, loadTitle: string): Promise<Music> {
    let parsedMusic: Music = Music.fromRequestObject(music)

    parsedMusic.LoadTitle = loadTitle;

    if (parsedMusic.Duration > 0) {
        return parsedMusic;
    }
    console.log(`Getting duration for ${parsedMusic.Path}`);
    let durationInSeconds = await getMediaDuration(parsedMusic.Path);
    parsedMusic.Duration = durationInSeconds; // Update duration value

    return parsedMusic;
}