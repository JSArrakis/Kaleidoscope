import { MediaType } from "../models/enum/mediaTypes";
import { Media } from "../models/media";
import { Movie } from "../models/movie";
import { SelectedMedia } from "../models/selectedMedia";
import { Episode, Show } from "../models/show";
import { StagedMedia } from "../models/stagedMedia";
import { StreamType } from "../models/enum/streamTypes";
import { IStreamRequest } from "../models/streamRequest";
import { WatchRecord } from "../models/progressionContext";
import { ManageShowProgression, GetShowListWatchRecords } from "./progressionManager";


export function getProceduralBlock(
    args: IStreamRequest,
    stagedMedia: StagedMedia,
    media: Media,
    prevMovies: Movie[],
    duration: number,
    latestTimePoint: number,
    streamType: StreamType
): SelectedMedia[] {
    let currDur: number = 0;
    let selectedMedia: SelectedMedia[] = [];
    let currentTimePoint = latestTimePoint;

    while (currDur < duration) {
        let durRemainder = duration - currDur;
        let injDurMovies = stagedMedia.InjectedMovies.filter(inj => inj.Duration <= durRemainder);
        let procDurMovies = media.Movies.filter(mov => mov.Duration <= durRemainder && !isMovieSelected(mov, prevMovies));
        if (injDurMovies.length > 0) {
            //TODO: Add logic to select injected movie based on genre walk (when designed and constructed)
            //separate movies that share tags with all scheduled movies that have gaps big enough to fit the duration
            //of the injected movies in the selection (so gaps that are 2 hours or more)
            //first match up all injected movies available with the adjacent tags into the appropriate gaps, then
            //the movies filling the gaps will be selected at random from the groupings by tag
            //now this will get complicated, but to make this intelligent, we will want to put anthologies in order through
            //the entire stream duration. So if we have multiple gaps that have tags where a movie that is part of an anthology
            //can be selected, we will want to select the movie that is next in the anthology. When an anthology movie is selected,
            //we will want to check against an anthology object array to see if this anthology has already been selected, and if so,
            //we will want to select the next movie in the anthology. If the anthology has not been selected, 
            let injMovie = injDurMovies[Math.floor(Math.random() * injDurMovies.length)];
            let indexInInjectedMovies: number = stagedMedia.InjectedMovies.indexOf(injMovie);

            injMovie.Time = currentTimePoint;
            stagedMedia.InjectedMovies.splice(indexInInjectedMovies, 1);
            selectedMedia.push(injMovie);
            prevMovies.push(injMovie.Media as Movie);
            currentTimePoint = currentTimePoint + injMovie.Duration
            currDur = currDur + injMovie.Duration;
        } else {
            if (durRemainder >= 5400) {
                //Movie or Show
                let selectedMovie = selectMovieUnderDuration(args, media.Movies, prevMovies, durRemainder);
                if (Math.random() > 0.5 && procDurMovies.length > 0 && selectedMovie !== undefined) {
                    let selectedMediaItem: SelectedMedia = new SelectedMedia(selectedMovie, "", MediaType.Movie, currentTimePoint, selectedMovie.DurationLimit, selectedMovie.Tags)
                    selectedMedia.push(selectedMediaItem);
                    prevMovies.push(selectedMovie);

                    currDur = currDur + selectedMovie.DurationLimit;
                    currentTimePoint = currentTimePoint + selectedMovie.DurationLimit;
                } else {
                    let result = getEpisodesUnderDuration(args, media.Shows, durRemainder, streamType);
                    result[0].forEach(episode => {

                        selectedMedia.push(new SelectedMedia(episode, result[1], MediaType.Episode, currentTimePoint, episode.DurationLimit, episode.Tags));
                        currDur = currDur + episode.DurationLimit;
                        currentTimePoint = currentTimePoint + episode.DurationLimit;
                    });
                }
            } else {
                //Show
                let result = getEpisodesUnderDuration(args, media.Shows, durRemainder, streamType);
                result[0].forEach(episode => {
                    selectedMedia.push(new SelectedMedia(episode, result[1], MediaType.Episode, currentTimePoint, episode.DurationLimit, episode.Tags));
                    currDur = currDur + episode.DurationLimit;
                    currentTimePoint = currentTimePoint + episode.DurationLimit;
                });
            }
        }
    }

    return selectedMedia;
}

export function selectMovieUnderDuration(options: IStreamRequest, movies: Movie[], prevMovies: Movie[], duration: number): Movie {
    let filteredMovies: Movie[] = movies.filter(movie =>
        movie.Tags.some(tag => options.Tags.includes(tag)) &&
        movie.DurationLimit <= duration
    );

    let notRepeatMovies: Movie[] = filteredMovies.filter((item) => !prevMovies.some((obj) => obj.LoadTitle === item.LoadTitle));

    let selectedMovie = notRepeatMovies.length > 0 ?
        notRepeatMovies[Math.floor(Math.random() * notRepeatMovies.length)] :
        filteredMovies[Math.floor(Math.random() * filteredMovies.length)];

    return selectedMovie;
}

export function getEpisodesUnderDuration(args: IStreamRequest, shows: Show[], duration: number, streamType: StreamType): [Episode[], string] {
    let episodes: Episode[] = [];
    let filteredShows: Show[] = shows.filter(show =>
        show.Tags.some(tag => args.Tags.includes(tag)) &&
        show.DurationLimit <= duration
    );

    // Sometimes a show will have a duration that is longer than the duration limit. Since we use the duration limit as the number to compare against the
    // duration available, this could potentially yeild a show that would run longer than the time slot available. Thus we need to see which shows have a duration
    // that is longer than the duration available. The WatchRecord of a show will have a boolean value determining that the next episode of a show is over its normal
    // duration limit, this value will be used in determining if the show can be selected or not for the selected duration slot.    
    // let showProgressions = GetFilteredShowProgressions(filteredShows, streamType);

    let [selectedShow, numberOfEpisodes] = selectShowByDuration(args, duration, filteredShows, streamType);
    if (selectedShow === undefined) {
        // TODO - If no shows at all are found for the duration available, then the duration slot will be filled with buffer media.
        throw new Error(
            "Something went wrong when selecting a show by Duration"
        );
    }

    // So this part gets the correct indicies for the correct episode number assigned to each episode of a show in the list
    // of episodes. This is done by checking the progression of the show and selecting the next episode in the list, which
    // also updates the WatchRecord object for the show in the ProgressionContext object. This is done against a local copy
    // of the progression and the DB is only updated if the media has finished playing in the stream.
    let episodeIndicies = ManageShowProgression(selectedShow, numberOfEpisodes, args, streamType);

    episodeIndicies.forEach(idx => {
        if (selectedShow !== undefined) {
            let episode = selectedShow.Episodes[idx - 1]
            //add selectedShow tags to episode tags that dont already exist
            episode.Tags = [...new Set([...selectedShow.Tags, ...episode.Tags])];
            episodes.push(episode);
        }
    })

    return [episodes, selectedShow.Title];
}

export function isMovieSelected(movie: Movie, prevMovies: Movie[]): boolean {
    return prevMovies.some(prevMovie => prevMovie.Title === movie.Title);
}

export function selectShowByDuration(args: IStreamRequest, duration: number, shows: Show[], streamType: StreamType): [Show | undefined, number] {
    let watchRecords: WatchRecord[] = GetShowListWatchRecords(args, shows, streamType);

    let selectedShows: Show[] = [];

    let numberOfEpisodes: number = 0;

    if (duration < 3600) {
        // Find all shows that have a next episode duration limit of 1800 using the watchRecords
        let minWatchRecords: WatchRecord[] = watchRecords.filter(wr => wr.NextEpisodeDurLimit === 1800);
        minWatchRecords.forEach(wr => {
            let show = shows.find(s => s.LoadTitle === wr.LoadTitle);
            if (show !== undefined) {
                selectedShows.push(show);
            }
        });
        numberOfEpisodes = 1;
    } else {
        // Find all watch records that have a next episode duration limit of 1800
        let minWatchRecords: WatchRecord[] = watchRecords.filter(wr => wr.NextEpisodeDurLimit === 1800);
        // Refine minWatchRecords to only include shows where the next two episodes have a duration limit of 1800
        minWatchRecords = minWatchRecords.filter(wr => {
            let show = shows.find(s => s.LoadTitle === wr.LoadTitle);
            if (show !== undefined) {
                let episodeNumber: number = wr.Episode + 2;
                if (episodeNumber > show.EpisodeCount) {
                    episodeNumber = episodeNumber - show.EpisodeCount;
                }
                let nextNextEpisode = show.Episodes.find(ep => ep.EpisodeNumber === episodeNumber);
                if (nextNextEpisode !== undefined) {
                    return nextNextEpisode.DurationLimit === 1800;
                }
            }
            return false;
        });

        // Find all watch record that have a next episode duration limit under the duration that are not in the minWatchRecords
        let allWatchRecords: WatchRecord[] = watchRecords.filter(wr => wr.NextEpisodeDurLimit <= duration && wr.NextEpisodeDurLimit > 1800);
        let selectedWatchRecords: WatchRecord[] = [];
        if (allWatchRecords.length > 0 && minWatchRecords.length > 0) {
            //Flip a coin to determine which set of watch records to use
            if (Math.random() < 0.5) {
                selectedWatchRecords = minWatchRecords;
                numberOfEpisodes = 2;
            } else {
                selectedWatchRecords = allWatchRecords;
                numberOfEpisodes = 1;
            }
        } else if (allWatchRecords.length === 0 && minWatchRecords.length === 0) {
            return [undefined, 0];
        } else if (allWatchRecords.length === 0) {
            selectedWatchRecords = minWatchRecords;
            numberOfEpisodes = 2;
        } else if (minWatchRecords.length === 0) {
            selectedWatchRecords = allWatchRecords;
            numberOfEpisodes = 1;
        }

        selectedWatchRecords.forEach(wr => {
            let show = shows.find(s => s.LoadTitle === wr.LoadTitle);
            if (show !== undefined) {
                selectedShows.push(show);
            }
        });
    }

    if (selectedShows.length === 0) {
        return [undefined, 0];
    }

    const randomIndex = Math.floor(Math.random() * selectedShows.length);
    return [selectedShows[randomIndex], numberOfEpisodes];
}
