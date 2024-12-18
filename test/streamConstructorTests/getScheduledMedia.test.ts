import { MediaType } from '../../src/models/enum/mediaTypes';
import { Media } from '../../src/models/media';
import {
  AdhocStreamRequest,
  ContStreamRequest,
  IStreamRequest,
} from '../../src/models/streamRequest';
import { SelectedMedia } from '../../src/models/selectedMedia';
import * as streamCon from '../../src/services/streamConstructor';
import * as tdMovies from '../testData/movies';

describe('getScheduledMedia', () => {
  const media = new Media(
    [], // Shows
    [tdMovies.inception, tdMovies.matrix, tdMovies.interstellar],
    [], // Shorts
    [], // Music
    [], // Promos
    [], // Default Promos
    [], // Commercials
    [], // Default Commercials
    [], // Collections
  );

  it('should schedule movies based on the provided timestamps', () => {
    const args: IStreamRequest = {
      Title: 'Example Title',
      Env: 'production',
      Movies: ['inception::1656547200', 'interstellar::1656633600'], // Timestamps represent example Unix times
      Tags: [],
      MultiTags: [],
      Collections: [],
      StartTime: 1656547200,
      Password: 'securepassword',
    };

    const expected = [
      new SelectedMedia(
        tdMovies.inception,
        '',
        MediaType.Movie,
        1656547200,
        9000,
        ['scifi'],
      ),
      new SelectedMedia(
        tdMovies.interstellar,
        '',
        MediaType.Movie,
        1656633600,
        10800,
        ['scifi'],
      ),
    ];

    const result = streamCon.getScheduledMedia(media, args);

    expect(result[0]).toEqual(expected);
    expect(result[1]).toBe('');
  });

  it('should ignore movies without the "::" delimiter', () => {
    const args: IStreamRequest = {
      Title: 'Example Title',
      Env: 'production',
      Movies: ['inception::1656547200', 'thematrix'],
      Tags: [],
      MultiTags: [],
      Collections: [],
      StartTime: 1656547200,
      Password: 'securepassword',
    };

    const expected = [
      new SelectedMedia(
        tdMovies.inception,
        '',
        MediaType.Movie,
        1656547200,
        9000,
        ['scifi'],
      ),
    ];

    const result = streamCon.getScheduledMedia(media, args);

    expect(result[0]).toEqual(expected);
    expect(result[1]).toBe('');
  });

  it('should return an error when a movie is not found', () => {
    const args: IStreamRequest = {
      Title: 'Example Title',
      Env: 'production',
      Movies: ['unknownmovie::1656547200'],
      Tags: [],
      MultiTags: [],
      Collections: [],
      StartTime: 1656547200,
      Password: 'securepassword',
    };

    const result = streamCon.getScheduledMedia(media, args);

    expect(result[0]).toEqual([]);
    expect(result[1]).toBe('unknownmovie load title, not found.');
  });

  it('should return an empty array when no movies are provided', () => {
    const args: IStreamRequest = {
      Title: 'Example Title',
      Env: 'production',
      Movies: [],
      Tags: [],
      MultiTags: [],
      Collections: [],
      StartTime: 1656547200,
      Password: 'securepassword',
    };

    const result = streamCon.getScheduledMedia(media, args);

    expect(result[0]).toEqual([]);
  });

  it('should sort the selected media based on time', () => {
    const args: IStreamRequest = {
      Title: 'Example Title',
      Env: 'production',
      Movies: ['interstellar::1656633600', 'inception::1656547200'],
      Tags: [],
      MultiTags: [],
      Collections: [],
      StartTime: 1656547200,
      Password: 'securepassword',
    };

    const expected = [
      new SelectedMedia(
        tdMovies.inception,
        '',
        MediaType.Movie,
        1656547200,
        9000,
        ['scifi'],
      ),
      new SelectedMedia(
        tdMovies.interstellar,
        '',
        MediaType.Movie,
        1656633600,
        10800,
        ['scifi'],
      ),
    ];

    const result = streamCon.getScheduledMedia(media, args);

    expect(result[0]).toEqual(expected);
    expect(result[1]).toBe('');
  });

  it('should handle multiple types of stream requests', () => {
    const contArgs = new ContStreamRequest(
      'securepassword',
      'Continuous Stream',
      'production',
      ['inception::1656547200', 'thematrix::1656633600'],
      ['tag1', 'tag2'],
      [['multiTag1'], ['multiTag2']],
      ['Collection1'],
      1656547200,
    );

    const adhocArgs = new AdhocStreamRequest(
      'securepassword',
      'Adhoc Stream',
      'production',
      ['interstellar::1656633600', 'inception::1656547200'],
      ['tag1', 'tag2'],
      [['multiTag1'], ['multiTag2']],
      ['Collection1'],
      1656547200,
      1656647200,
    );

    const contExpected = [
      new SelectedMedia(
        tdMovies.inception,
        '',
        MediaType.Movie,
        1656547200,
        9000,
        ['scifi'],
      ),
      new SelectedMedia(
        tdMovies.matrix,
        '',
        MediaType.Movie,
        1656633600,
        9000,
        ['action'],
      ),
    ];

    const adhocExpected = [
      new SelectedMedia(
        tdMovies.inception,
        '',
        MediaType.Movie,
        1656547200,
        9000,
        ['scifi'],
      ),
      new SelectedMedia(
        tdMovies.interstellar,
        '',
        MediaType.Movie,
        1656633600,
        10800,
        ['scifi'],
      ),
    ];

    const contResult = streamCon.getScheduledMedia(media, contArgs);
    const adhocResult = streamCon.getScheduledMedia(media, adhocArgs);

    expect(contResult[0]).toEqual(contExpected);
    expect(contResult[1]).toBe('');
    expect(adhocResult[0]).toEqual(adhocExpected);
    expect(adhocResult[1]).toBe('');
  });
});
