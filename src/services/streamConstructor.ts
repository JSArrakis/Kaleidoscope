import { Config } from "../models/config";
import { loadTranslationTags } from "./dataManager";
import { Media } from "../models/media";
import { Movie } from "../models/movie";
import { Collection } from "../models/collection";
import moment from 'moment';
import { MediaType } from "../models/enum/mediaTypes";
import { SelectedMedia } from "../models/selectedMedia";
import { StagedMedia } from "../models/stagedMedia";
import { getProceduralBlock } from "./proceduralEngine";
import { Show } from "../models/show";
import { TranslationTag } from "../models/translationTag";
import { createBuffer } from "./bufferEngine";
import { MediaBlock } from "../models/mediaBlock";
import { IStreamRequest } from "../models/v1/streamRequest";
import { ManageShowProgression } from "./progressionManager";

export function constructStream(
    config: Config,
    options: IStreamRequest,
    media: Media,
    transaltionTags: TranslationTag[] = loadTranslationTags(config.DataFolder + 'translationTags.json')):
    [MediaBlock[], string] {
    let rightNow: number = moment().unix()
    let error: string = "";
    console.log("Right Now: " + rightNow)
    let streamBlocks: MediaBlock[] = [];

    // Set which audience is being targeted with the stream

    // Get the media that is scheduled to be played from the api request (movies that are selected to be played at a specific time)
    // This detects if a movie is scheduled to be played at a specific time and adds it to the stream
    // The format of the string is "MovieTitle::Time" where time is the unix timestamp of when the movie is scheduled to be played
    // TODO - Change the format of the scheduled movies request to be an array of objects with a title and time property for easier parsing
    let scheduledMedia: SelectedMedia[] = getScheduledMedia(options, media);

    // Get the media that is specifically requested from the incoming http request and the end time of the stream to create a collection
    // of media that is ordered by scheduled time and 'injected' media that is requested by the user
    // The staged media object is used to determine the order of the stream. The scheduled media will always play at the time it is scheduled
    // The injected media will fill the gaps between the scheduled media where the duration and time available allows
    // Any further time that is available after the scheduled media is filled with procedural selected media based on tagging
    // TODO - injected media for a continuous stream should take better consideration for the "genre walk" we want to create. 
    // Due to the nature of the continuous stream, the injected media can and should be available to be played beyond just "today"
    // and should be subject to the rules of the genre walk to give a better experience to the viewer, scheduling these movies beyond the initial stream day to allow for a smoother "walk"
    // We might even want to consider removing the ability to inject media for a continuous stream and rely on the future API endpoints to inject movies manually
    // Or we could remove Staged Media for a continuous stream entirely and only use tags for the base stream generation
    let stagedMedia = new StagedMedia(
        scheduledMedia,
        getInjectedMovies(options, media.Movies),
        evaluateStreamEndTime(options, scheduledMedia)
    );

    // Get genre tag from the media that is scheduled and injected if no tags are selected by the user
    setProceduralTags(options, stagedMedia);

    // Using the scheduled media and injected media, create a stream of media blocks that will be played in order
    // The stream is created by filling the time between the scheduled and injected media with procedural media based on the genre tags available
    // These are only the main media items, the buffer media is added to the stream in the next step
    let stagedStreamResponse: [SelectedMedia[], string] = getStagedStream(rightNow, config, options, stagedMedia, media);
    if (stagedStreamResponse[1] !== "") {
        error = stagedStreamResponse[1];
        return [[], error];
    }
    let stagedStream = stagedStreamResponse[0];

    // An Object that holds previously played media to prevent the same media from being played in the same stream before a certain interval
    // Each media item in prevBuffer is added or removed based on its own rules. I.E. commercials are added if they are selected for a buffer but will be removed after the next
    // buffer is created and be replaced by that buffer's commercials. There are exceptions and special circumstances when this is not the case
    let prevBuffer: Media = new Media([], [], [], [], [], [], []);

    // Creates the buffer media to fill the time between when the stream is initilized and the first media item being played
    // The first media item played should be timed to the first 30 minute or hour mark on the clock
    // This initial buffer is created to ensure that the first media item is played at the correct time
    // TODO - change initial buffer into an object instead of an array
    let initialBuffer = createBuffer(
        stagedStream[0].Time - rightNow,
        options,
        media,
        [],
        stagedStream[0].Tags,
        transaltionTags,
        prevBuffer)

    // Boolean to be used later to determine if there is an initial buffer to be added to the stream
    let hasInitialBuffer = initialBuffer[0].length > 0 ? true : false;

    // Adds the initial buffer to the prevBuffer object
    prevBuffer = initialBuffer[2];

    // If there is any remaining time the initial buffer did not fill, that remaining time is assigned to the remainder variable
    // This variable gets passed to the next buffer to correct the schedule and keep things on time
    let remainder = initialBuffer[1];

    // Loops through the staged stream of media items and creates a media block for each item
    // A media block is an object that holds the main media item and the buffer media that will be played after the main media item
    stagedStream.forEach((item, index) => {
        // Boolean to determine if the current media item is the last item in the time frame for this stream (determined by the user or the end of the day)
        let lastItem = index === stagedStream.length - 1 ? true : false;

        if (item.Type == MediaType.Episode || item.Type == MediaType.Movie) {
            let mediaBlock = new MediaBlock([], [], undefined, undefined);
            // Add main media item to the media block
            let mediaItem = item.Media;
            mediaBlock.MainBlock = mediaItem;
            // Adds the assigned start time for the main media item to the media block
            mediaBlock.StartTime = item.Time;

            // Get the duration of the buffer media that will be played after the main media item
            // TODO - this does not take into account OverDuration media items
            // We will need a way to calculate the duration of the buffer using the length of the media item and when the next media item is scheduled to play or the end of the stream
            let bufferDuration = mediaItem.DurationLimit - mediaItem.Duration

            // Creates the buffer media for this current block
            // The buffer is selected based on the tags of the current media item and the next media item in the stream
            // Unless the it is initial buffer or the last buffer of the stream, the buffer is split in half to allow for a smoother transition between media items
            // The middle of the buffer in these cases will always be the promo item based on the environment of the stream
            // The first half of the buffer will be themed to the media that aired befor the buffer, and the second half will be themed to the media that will air after the buffer
            let buffer = createBuffer(
                bufferDuration + remainder,
                options,
                media,
                stagedStream[index].Tags,
                lastItem ? [] : stagedStream[index + 1].Tags,
                transaltionTags,
                prevBuffer);

            // The sum of all selected media items in the buffer is added to the total duration of the Media Block
            let totalDuration: number = 0;
            for (const obj of buffer[0]) {
                totalDuration += obj.Duration;
            }
            // Replaces the stored previous buffer with the buffer that was just created to prevent these media items from being played during the next buffer
            prevBuffer = buffer[2];

            // Adds the buffer media to the media block
            mediaBlock.Buffer.push(...buffer[0]);
            // resets the remainder varliable to the new remainder from the buffer if any to be used in the next iteration of this loop
            remainder = buffer[1];
            // If this is the first media item in the stream and there is an initial buffer, add the initial buffer to the media block
            if (index === 0 && hasInitialBuffer) {
                mediaBlock.InitialBuffer.push(...initialBuffer[0]);
                hasInitialBuffer = false;
            }
            // Adds the media block to the stream blocks array, order matters here as this is the order the media will be played in
            // as this array will be used as the upcoming stream variable used by the background service with shift() to add the next media item to the stream
            streamBlocks.push(mediaBlock);
        }
        // TODO - Collections
        // Collections are not currently supported in the stream constructor due to old code before it was rewritten in Typescript
        // Collections are a specific grouping of shows, movies or other specific media items that are played in a specific order
        // This could be a series of movies that are played in order, a series of shows that are played in order, or a mix of both
        // We will need to also consider music blocks and other media types that are not currently supported in the stream constructor
        // The progression engine should keep track of each collections progression for each show in the collection, this functionality
        // is meant to keep each collection progression siloed from each other and from the main stream progression 

        // else if (item.Media instanceof Collection) {
        //     let collection = item.Media;
        //     let collectionBlock = createCollectionBlock(
        //         collection,
        //         progression,
        //         options,
        //         media,
        //         transaltionTags,
        //         prevBuffer);
        //     streamPaths.push(...collectionBlock[0]);
        //     remainder = collectionBlock[1];
        // }

    });
    return [streamBlocks, error];
}

// function createCollectionBlock(
//     collection: Collection,
//     progression: MediaProgression[],
//     options: any,
//     media: Media,
//     transaltionTags: TranslationTag[],
//     prevBuffer: Media): [string[], number] {
//     /* 
//     -- This logic is to determine if a show should be populated in the stream for a collection. If the show
//     runs longer than the alloted time block for that show, skip the show following it. 
//     Time remaining will be filled with buffer media 
//     */

//     /*
//     -- Author note:: A good example of this is with the summer 2000 broadcast of Toonami with Tenchi Muyo. 
//     Tenchi has a few episodes that are weirdly 45 minutes instead of 30 minutes randomly with no real rhyme 
//     or reason. To handle this randomness, Toonami in it's original broadcast pulled the episode of Batman the 
//     Animated series which usually followed Tenchi for that day only and populated the remainder of the 
//     15 minutes that would have normally been Batman with Power Puff Girl episodes instead. This allowed 
//     Toonami to keep the fidelity of a 3 hour block run time and decreasing dead time and keeping interest of the 
//     audience while staying within theme (Toonami being a series of mostly violence driven animated shows 
//     in which the only Cartoon Network licensed property that fit in the alloted time slot that was also 
//     themed correctly was PPG)
//     */
//     let remainder = 0;
//     let stream: string[] = [];
//     collection.Shows.forEach((show, index) => {
//         let lastShowEpisode = collection.Shows[index - 1].Episode;
//         if (lastShowEpisode) {
//             if (lastShowEpisode.Duration > lastShowEpisode.DurationLimit) {
//                 ReduceProgression(collection.Title, show.LoadTitle, progression)
//             } else {
//                 let episode = show.Episode;
//                 if (episode) {
//                     stream.push(episode.Path)
//                     if (episode.Duration > episode.DurationLimit) {
//                         let nextShowEpisode = collection.Shows[index + 1].Episode;
//                         if (nextShowEpisode) {
//                             let overDurationLength = (nextShowEpisode.DurationLimit + episode.DurationLimit) - episode.Duration + remainder;
//                             let overBuffer = createBuffer(
//                                 [],
//                                 overDurationLength,
//                                 options,
//                                 media,
//                                 [collection.LoadTitle],
//                                 [collection.LoadTitle],
//                                 transaltionTags,
//                                 prevBuffer)
//                             stream.push(...overBuffer[0].map(obj => obj.Path));
//                             remainder = overBuffer[1];
//                         }
//                     } else {
//                         let underBuffer = createBuffer(
//                             [],
//                             episode.DurationLimit - episode.Duration,
//                             options,
//                             media,
//                             [collection.LoadTitle],
//                             [collection.LoadTitle],
//                             transaltionTags,
//                             prevBuffer)
//                         stream.push(...underBuffer[0].map(obj => obj.Path));
//                         remainder = underBuffer[1];
//                     }
//                 }
//             }
//         }
//     });
//     return [stream, remainder];
// }

export function getFirstProceduralDuration(rightNow: number, stagedMedia: StagedMedia): number {
    let firstTimePoint: number = stagedMedia.EndTime;

    if (stagedMedia.ScheduledMedia.length > 0) {
        firstTimePoint = stagedMedia.ScheduledMedia[0].Time;
    }

    return firstTimePoint - rightNow;
}

export function setProceduralBlockDurations(interval: number, firstProceduralDuration: number) {
    let preMediaDuration = 0;
    let initialProceduralBlockDuration = 0;

    if (firstProceduralDuration / interval >= 1) {
        preMediaDuration = firstProceduralDuration % interval;
        initialProceduralBlockDuration = firstProceduralDuration - preMediaDuration;
    } else {
        preMediaDuration = firstProceduralDuration;
    }

    return { preMediaDuration, initialProceduralBlockDuration };
}

export function getStagedStream(
    rightNow: number,
    config: Config,
    options: any,
    stagedMedia: StagedMedia,
    media: Media): [selectedMedia: SelectedMedia[], error: string] {
    let error: string = "";

    let firstProceduralDuration = getFirstProceduralDuration(rightNow, stagedMedia);
    if (firstProceduralDuration < 0) {
        error = "Time of first movie, collection, or selected end time needs to be in the future.";
    }

    let interval = config.Interval;
    let { preMediaDuration, initialProceduralBlockDuration } = setProceduralBlockDurations(interval, firstProceduralDuration);
    let selectedMedia: SelectedMedia[] = [];
    let prevMovies: Movie[] = [];

    if (initialProceduralBlockDuration > 0) {
        let firstProceduralBlock = getProceduralBlock(
            config,
            options,
            stagedMedia,
            media,
            prevMovies,
            initialProceduralBlockDuration,
            rightNow + preMediaDuration
        );
        selectedMedia.push(...firstProceduralBlock);
    }

    stagedMedia.ScheduledMedia.forEach((item, index) => {
        selectedMedia.push(item);
        if (index < stagedMedia.ScheduledMedia.length - 1) {
            let procDuration = stagedMedia.ScheduledMedia[index + 1].Time - stagedMedia.ScheduledMedia[index].Time - stagedMedia.ScheduledMedia[index].Duration;
            if (procDuration > 0) {
                let intermediateProcBlock = getProceduralBlock(
                    config,
                    options,
                    stagedMedia,
                    media,
                    prevMovies,
                    procDuration,
                    stagedMedia.ScheduledMedia[index].Time + stagedMedia.ScheduledMedia[index].Duration
                );
                selectedMedia.push(...intermediateProcBlock);
            }
        }
    })

    if (stagedMedia.ScheduledMedia.length > 0) {
        let lastScheduledMedia = stagedMedia.ScheduledMedia[stagedMedia.ScheduledMedia.length - 1];
        let scheduledEndTime = stagedMedia.EndTime;
        let endProcDuration = scheduledEndTime - lastScheduledMedia.Time - lastScheduledMedia.Duration;
        if (endProcDuration > 0) {
            let endProcBlock = getProceduralBlock(
                config,
                options,
                stagedMedia,
                media,
                prevMovies,
                endProcDuration,
                stagedMedia.ScheduledMedia[stagedMedia.ScheduledMedia.length - 1].Time + stagedMedia.ScheduledMedia[stagedMedia.ScheduledMedia.length - 1].Duration
            );
            selectedMedia.push(...endProcBlock);
        }
    }

    return [selectedMedia, error];
}

export function setProceduralTags(options: IStreamRequest, stagedMedia: StagedMedia): void {
    if (options.MultiTags === undefined
        && options.Tags === undefined) {

        let tagList: string[] = [];
        stagedMedia.InjectedMovies.forEach(inj => tagList.push(...inj.Media.Tags));
        stagedMedia.ScheduledMedia.forEach(sch => tagList.push(...sch.Media.Tags));
        let uniquetags: string[] = [];
        for (let i = 0; i < tagList.length; i++) {
            if (uniquetags.indexOf(tagList[i]) === -1) {
                uniquetags.push(tagList[i]);
            }
        }
        options.Tags = uniquetags;
        //TODO: v1.4 Create different combos of block tags for tagsAND to give a more streamlined experience
    }
}

export function evaluateStreamEndTime(options: any, scheduledMedia: SelectedMedia[]): number {
    let endTime: number = moment().startOf('day').add(1, "days").unix();

    if (options.endTime) {
        let selectedEndTime = parseInt(options.endTime);
        compareSelectedEndTime(selectedEndTime, scheduledMedia);
        endTime = selectedEndTime;
    } else if (scheduledMedia.length > 0) {
        let lastScheduledMedia = scheduledMedia[scheduledMedia.length - 1];
        endTime = lastScheduledMedia.Time + lastScheduledMedia.Media.DurationLimit;
    }

    return endTime;
}

function compareSelectedEndTime(endTime: number, scheduledMedia: SelectedMedia[]) {
    scheduledMedia.forEach(item => {
        if (item.Time + item.Media.DurationLimit > endTime) {
            throw "Scheduled time for " + item.Media.LoadTitle + " exceeds selected endTime";
        }
    })
}

export function getScheduledMedia(options: any, media: Media): SelectedMedia[] {

    let selectedMedia: SelectedMedia[] = [];
    // Parses the incoming http request for scheduled movies and collections
    // The format of the string is "MovieTitle::Time" where time is the unix timestamp of when the movie is scheduled to be played
    if (options.movies) {
        options.movies
            //Gets only the movies that have the time schedule delimiter "::"
            .filter((str: string) => str.includes('::'))
            .forEach((str: string) => {
                // Splits the string into an array of strings with the movie title and the time it is scheduled to be played
                let parsedMovie = str.split("::");
                selectedMedia.push(getMovie(parsedMovie[0], media.Movies, parseInt(parsedMovie[1])));
            });
    }

    // Blocks should be in the format "CollectionTitle::EpisodeNumber"
    // TODO - Rename blocks to collections in the options object
    // TODO - For continuous streams, we need to make sure that we have a way to specify the interval of days or weeks that a collection
    // should be played. This will allow us to schedule collections to be played on specific days of the week or at specific intervals.
    // This allows for things like the "Toonami Midnight Run" where a specific show is played at a specific time on a specific day of the week
    // or Nickelodeons 90s Saturday Morning blocks. This will also allow us to schedule collections to be played on specific holidays or events
    if (options.blocks) {
        options.blocks
            // Gets only the collections that have the time schedule delimiter "::"
            // Sometimes a collection can just be added that doesnt need to be scheduled. Collections can also be marathons of movies or shows 
            // that are played in order and do not need to be scheduled at a specific time
            .filter((str: string) => str.includes('::'))
            .forEach((str: string) => {
                let parsedCollection = str.split("::");
                selectedMedia.push(getCollection(parsedCollection[0], media, parseInt(parsedCollection[1])));
            });
    }
    // Sorts the the selected media based on the unix timestamp of when the media is scheduled to be played
    let sorted = selectedMedia.sort((a, b) => a.Time - b.Time);
    return sorted;
}

export function getInjectedMovies(options: any, movies: Movie[]): SelectedMedia[] {
    let selectedMedia: SelectedMedia[] = [];
    if (options.movies !== undefined) {
        options.movies
            .filter((str: string) => !str.includes('::'))
            .forEach((str: string) => {
                selectedMedia.push(getMovie(str, movies, 0));
            });
    }
    return selectedMedia;
}

export function getMovie(loadTitle: string, movieList: Movie[], time: number): SelectedMedia {
    // Check if the movie title is empty or undefined as these cannot be searched against the movie list
    if (loadTitle === "" || loadTitle === undefined) {
        throw loadTitle + "Empty movie titles are not a valid input";
    }
    // Check if the movie title is in the movie list
    // The load title is the title that is used to load the movie from the database and is unique to each movie
    // The format of the load title is the title of the movie with spaces, special characters, and capitalization removed
    // The movie object consists of the title of the movie, the duration of the movie, the tags associated with the movie, and the load title
    let selectedMovie: Movie | undefined = movieList.find(movie => movie.LoadTitle === loadTitle);

    // TODO - We should perhaps instead send back some kind of error message through the response object of the http request
    if (selectedMovie === undefined) {
        throw loadTitle + " load title, not found.";
    }

    // Created a selected media object that holds the selected movie, the time it is scheduled to be played, the duration of the movie, the tags associated with the movie, and the type of media
    return new SelectedMedia(
        selectedMovie,
        "",
        MediaType.Movie,
        time,
        selectedMovie.DurationLimit,
        selectedMovie.Tags
    )
}

export function getCollection(loadTitle: string, media: Media, time: number): SelectedMedia {
    // Check if the collection title is empty or undefined as these cannot be searched against the collection list
    if (loadTitle === "" || loadTitle === undefined) {
        throw loadTitle + "Empty collection titles are not a valid input";
    }

    // Check if the collection title is in the collection list
    let selectedCollection: Collection | undefined = media.Collections.find(collection => collection.LoadTitle === loadTitle);
    if (selectedCollection === undefined) {
        throw loadTitle + " is not a valid load title for a collection, re-check your spelling or make sure the title youre attempting to load exists.";
    }

    // If a collection has shows assigned to it, assign the episodes to the collection shows based on the progression of the shows
    assignCollEpisodes(selectedCollection, media.Shows);

    return new SelectedMedia(
        selectedCollection,
        "",
        MediaType.Collection,
        time,
        selectedCollection.DurationLimit,
        selectedCollection.Tags
    )
}

export function assignCollEpisodes(collection: Collection, shows: Show[]): void {
    // Assigns the episodes to the collection shows based on the progression of the shows
    // TODO - If the same show appears multiple times in a collection, we will need to figure out how to represent that in the collection
    // so it can be ran through this loop, or we will have to how the loop works to account for that
    // possibly just have the shows in the collection show array to have the possibility of multiple entries with their individual sequence numbers
    collection.Shows.forEach(collShow => {
        //TODO: This is a very basic implementation of show progression, we will need to add more functionality to this to account for shows that have multiple episodes
        // Find the show that matches the load title of the collection show
        let selectedShow = shows.filter(item => item.LoadTitle === collShow.LoadTitle)[0];
        // Get the episode number that the show should be on based on the progression of the show
        let episodeNum = ManageShowProgression(selectedShow, 1, collection.Title)
        // Get the episode that matches the episode number from the progression
        collShow.Episode = selectedShow.Episodes.filter(ep => ep.EpisodeNumber === episodeNum[0])[0];
    })
}