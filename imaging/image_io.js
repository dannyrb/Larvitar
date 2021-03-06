/** @module imaging/io
 *  @desc This file provides i/o functionalities on DICOM series
 *  @todo Document
 */

// external libraries
import cornerstone from "cornerstone-core";
import { forEach } from "lodash";
import nrrdjs from "@jonathanlurie/nrrdjs";

// internal libraries
import { getMeanValue, getDistanceBetweenSlices } from "./image_utils.js";

/*
 * This module provides the following functions to be exported:
 * cacheAndSaveSerie(series)
 * buildHeader(series)
 * buildData(series)
 * importNRRDImage(bufferArray)
 */

/**
 * Save image as volume: build header and data (use the cache to extract original pixel arrays)
 * @function cacheAndSaveSerie
 * @param {Object} series - Cornerstone series object
 * @returns {Object} {data: pixeldata, header: image metadata}
 */
export const cacheAndSaveSerie = async function (series) {
  // Purge the cache
  cornerstone.imageCache.purgeCache();
  // Ensure all image of series to be cached
  await Promise.all(
    series.imageIds.map(imageId => {
      return cornerstone.loadAndCacheImage(imageId);
    })
  );
  // At this time all images are cached
  // Now save the serie
  const header = buildHeader(series);
  const data = buildData(series);
  return { data, header };
};

/**
 * Build the image header from slices' metadata
 * @function buildHeader
 * @param {Object} series - Cornerstone series object
 * @returns {Object} header: image metadata
 */
export const buildHeader = function (series) {
  let header = {};
  header.volume = {};
  header.volume.imageIds = series.imageIds;
  header.volume.seriesId =
    series.instances[series.imageIds[0]].metadata.seriesUID;
  header.volume.rows =
    series.instances[series.imageIds[0]].metadata.rows ||
    series.instances[series.imageIds[0]].metadata.x00280010;
  header.volume.cols =
    series.instances[series.imageIds[0]].metadata.cols ||
    series.instances[series.imageIds[0]].metadata.x00280011;
  header.volume.slope = series.instances[series.imageIds[0]].metadata.slope;
  header.volume.repr = series.instances[series.imageIds[0]].metadata.repr;
  header.volume.intercept =
    series.instances[series.imageIds[0]].metadata.intercept;
  header.volume.imagePosition =
    series.instances[series.imageIds[0]].metadata.imagePosition;
  header.volume.numberOfSlices = series.imageIds.length;

  header.volume.imageOrientation = getMeanValue(
    series,
    "imageOrientation",
    true
  );

  header.volume.pixelSpacing = getMeanValue(series, "pixelSpacing", true);
  header.volume.maxPixelValue = getMeanValue(series, "maxPixelValue", false);
  header.volume.minPixelValue = getMeanValue(series, "minPixelValue", false);
  header.volume.sliceThickness = getDistanceBetweenSlices(series, 0, 1);

  forEach(series.imageIds, function (imageId) {
    header[imageId] = series.instances[imageId].metadata;
  });
  return header;
};

/**
 * Build the contiguous typed array from slices
 * @function buildData
 * @param {Object} series - Cornerstone series object
 * @param {Bool} useSeriesData - Flag to force using "series" data instead of cached ones
 * @returns {Array} Contiguous pixel array
 */
export const buildData = function (series, useSeriesData) {
  let repr = series.instances[series.imageIds[0]].metadata.repr;
  let rows =
    series.instances[series.imageIds[0]].metadata.rows ||
    series.instances[series.imageIds[0]].metadata.x00280010;
  let cols =
    series.instances[series.imageIds[0]].metadata.cols ||
    series.instances[series.imageIds[0]].metadata.x00280011;
  let len = rows * cols * series.imageIds.length;

  let data;
  switch (repr) {
    case "Uint8":
      data = new Uint8Array(len);
      break;
    case "Sint8":
      data = new Int8Array(len);
      break;
    case "Uint16":
      data = new Uint16Array(len);
      break;
    case "Sint16":
      data = new Int16Array(len);
      break;
    case "Uint32":
      data = new Uint32Array(len);
      break;
    case "Sint32":
      data = new Int32Array(len);
      break;
    default:
      data = new Uint8Array(len);
      break;
  }
  let offsetData = 0;

  // use input data or cached data
  if (useSeriesData) {
    forEach(series.imageIds, function (imageId) {
      const sliceData = series.instances[imageId].pixelData;
      data.set(sliceData, offsetData);
      offsetData += sliceData.length;
    });
  } else {
    forEach(cornerstone.imageCache.cachedImages, function (cachedImage) {
      const sliceData = cachedImage.image.getPixelData();
      data.set(sliceData, offsetData);
      offsetData += sliceData.length;
    });
  }

  return data;
};

/**
 * Import NRRD image from bufferArray (use nrrdjs @link https://github.com/jonathanlurie/nrrdjs)
 * @function importNRRDImage
 * @param {ArrayBuffer} bufferArray - buffer array from nrrd file
 * @returns {Array} Parsed pixel data array
 */
export const importNRRDImage = function (bufferArray) {
  // get the data
  let volume = nrrdjs.parse(bufferArray, {});
  return volume;
};
