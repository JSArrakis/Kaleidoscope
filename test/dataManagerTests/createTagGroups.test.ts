import { MainGenres } from "../../src/models/const/mainGenres";
import * as dataMan from "../../src/services/dataManager";

describe('createTagGroups', () => {
    it('should return the media that have the tags (scenario 1)', () => {
        const tags: string[] = [];

        const expectedTags: string[][] = [];

        const result: string[][] =
            dataMan.createTagGroups(tags);
        
        expect(result).toEqual(expectedTags);
    });
    it('should return the media that have the tags (scenario 2)', () => {
        const tags: string[] = [
            MainGenres.Action,
            MainGenres.SciFi,
            MainGenres.Horror,
        ];

        const expectedTags: string[][] = [
            [
                MainGenres.Action,
                MainGenres.SciFi,
            ],
                        [
                MainGenres.Action,
                MainGenres.Horror,
            ],
            [
                MainGenres.SciFi,
                MainGenres.Horror,
            ],
        ];

        const result: string[][] =
            dataMan.createTagGroups(tags);
        
        expect(result).toEqual(expectedTags);
    });
});