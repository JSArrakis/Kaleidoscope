import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PromoModel, Promo } from '../models/promo';
import { LoadTitleError } from '../models/loadTitleError';
import { getMediaDuration, createMediaValidation } from './common';

// ===========================================
//               PROMO HANDLERS
// ===========================================

export async function createPromoHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    let loadTitle = req.body.title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // Retrieve promo from MongoDB using promo load title if it exists
    const promo = await PromoModel.findOne({ LoadTitle: loadTitle });

    // If it exists, return error
    if (promo) {
        res.status(400).json({ message: "Promo already exists" });
        return;
    }
    // If it doesn't exist, perform transformations
    let transformedComm = await transformPromoFromRequest(req.body, loadTitle);

    // Insert promo into MongoDB
    await PromoModel.create(transformedComm);

    res.status(200).json({ message: "Promo Created" });
    return;
}

export async function bulkCreatePromoHandler(req: Request, res: Response): Promise<void> {
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
        res.status(400).json({ message: "Request body must be an array of promo objects" });
        return;
    }
    let createdPromos: string[] = [];
    let responseErrors: LoadTitleError[] = [];
    for (const promoEntry of req.body) {
        let err = createMediaValidation(promoEntry);
        if (err !== '') {
            responseErrors.push(new LoadTitleError(promoEntry.loadTitle, err));
            continue;
        }
        try {
            let loadTitle = promoEntry.title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const promo = await PromoModel.findOne({ LoadTitle: loadTitle });
            if (promo) {
                // If it exists, return error
                responseErrors.push(new LoadTitleError(promoEntry.title, `Promo ${promoEntry.loadTitle} already exists`));
                continue;
            }

            let transformedComm = await transformPromoFromRequest(promoEntry, loadTitle);

            await PromoModel.create(transformedComm);
            createdPromos.push(transformedComm.LoadTitle);
        } catch (err) {
            responseErrors.push(new LoadTitleError(promoEntry.loadTitle, err as string));
        }
    }

    if (responseErrors.length === req.body.length) {
        res.status(400).json({ message: "Promos Not Created", createdPromos: [], errors: responseErrors });
        return;
    }

    res.status(200).json({ message: "Promos Created", createdPromos: createdPromos, errors: responseErrors });
    return;
}

export async function deletePromoHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve promo from MongoDB using promo load title if it exists
    const promo = await PromoModel.findOne({ LoadTitle: req.query.loadTitle });

    // If it doesn't exist, return error
    if (!promo) {
        res.status(400).json({ message: "Promo does not exist" });
        return;
    }

    // If it exists, delete it
    await PromoModel.deleteOne({ _id: promo._id });

    res.status(200).json({ message: "Promo Deleted" });
    return;
}

export async function updatePromoHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve promo from MongoDB using promo load title if it exists
    const promo = await PromoModel.findOne({ Path: req.body.path });

    // If it doesn't exist, return error
    if (!promo) {
        res.status(400).json({ message: "Promo does not exist" });
        return;
    }

    // If it exists, perform transformations
    let updatedPromo = await transformPromoFromRequest(req.body, promo.LoadTitle);

    // Update promo in MongoDB
    await PromoModel.updateOne({ _id: promo._id }, updatedPromo);

    res.status(200).json({ message: "Promo Updated" });
    return;
}

export async function getPromoHandler(req: Request, res: Response): Promise<void> {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    // Retrieve promo from MongoDB using promo load title if it exists using request params
    const promo = await PromoModel.findOne({ LoadTitle: req.query.loadTitle });

    // If it doesn't exist, return error
    if (!promo) {
        res.status(404).json({ message: "Promo does not exist" });
        return;
    }

    res.status(200).json(promo);
    return;
}

export async function getAllPromosHandler(req: Request, res: Response): Promise<void> {
    const promos = await PromoModel.find({});

    if (!promos || promos.length === 0) {
        res.status(404).json({ message: "No Promos Found" });
        return;
    }
    res.status(200).json(promos);
    return;
}

// ===========================================
//          DEFAULT PROMO HANDLERS
// ===========================================  

export async function getAllDefaultPromosHandler(req: Request, res: Response): Promise<void> {
    const promos = await PromoModel.find({});

    if (!promos || promos.length === 0) {
        res.status(404).json({ message: "Default No Promos Found" });
        return;
    }
    res.status(200).json(promos);
    return;
}

export async function transformPromoFromRequest(promo: any, loadTitle: string): Promise<Promo> {
    let parsedPromo: Promo = Promo.fromRequestObject(promo)

    parsedPromo.LoadTitle = loadTitle;

    if (parsedPromo.Duration > 0) {
        return parsedPromo;
    }
    console.log(`Getting duration for ${parsedPromo.Path}`);
    let durationInSeconds = await getMediaDuration(parsedPromo.Path);
    parsedPromo.Duration = durationInSeconds; // Update duration value

    return parsedPromo;
}