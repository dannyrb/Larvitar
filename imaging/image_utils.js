/** @module imaging/utils
 *  @desc This file provides utility functions for
 *        manipulating image pixels and image metadata
 *  @todo Document
 */

// external libraries
import {
  isEmpty,
  sortBy,
  clone,
  max,
  map,
  forEach,
  extend,
  indexOf,
  random
} from "lodash";
import uuid from "uuid";

// internal libraries
import { getCustomImageId, getSerieDimensions } from "./loaders/commonLoader";

const TAG_DICT = require("./dataDictionary.json");

// global module variables
// variables used to manage the reslice functionality
const resliceTable = {
  sagittal: { coronal: [-2, 1, 0], axial: [-2, 0, -1] },
  coronal: { sagittal: [2, 1, -0], axial: [0, 2, -1] },
  axial: { sagittal: [1, -2, -0], coronal: [0, -2, 1] }
};

/*
 * This module provides the following functions to be exported:
 * getNormalOrientation(array[6])
 * getMinPixelValue(defaultValue, pixelData)
 * getMaxPixelValue(defaultValue, pixelData)
 * getPixelRepresentation(dataset)
 * getPixelTypedArray(dataset, pixelDataElement)
 * getSortedStack(seriesData, sortPriorities, returnSuccessMethod)
 * getTagValue(dataSet, tag)
 * randomId()
 * getMeanValue(series, tag, isArray)
 * getReslicedMetadata(reslicedSeriesId, fromOrientation, toOrientation, seriesData, imageLoaderName)
 * getReslicedPixeldata(imageId, originalData, reslicedData)
 * parseImageId(imageId)
 * getDistanceBetweenSlices(seriesData, sliceIndex1, sliceIndex2)
 * remapVoxel([i,j,k], fromOrientation, toOrientation)
 */

// ================================================
// Return computed 3D normal from two 3D vectors ==
// el is the image_orientation dicom tag ==========
// ================================================
export const getNormalOrientation = function(el) {
  let a = [el[0], el[1], el[2]];
  let b = [el[3], el[4], el[5]];

  let n = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];

  return n;
};

// =======================================================
// Get the min pixel value from series if not specified ==
// =======================================================
export const getMinPixelValue = function(value, pixelData) {
  if (value !== undefined) {
    return value;
  }
  let min;
  for (let i = 0; i < pixelData.length; i++) {
    if (!min || min > pixelData[i]) {
      min = pixelData[i];
    }
  }
  return min;
};

// =======================================================
// Get the max pixel value from series if not specified ==
// =======================================================
export const getMaxPixelValue = function(value, pixelData) {
  if (value !== undefined) {
    return value;
  }

  let max;
  for (let i = 0; i < pixelData.length; i++) {
    if (!max || max < pixelData[i]) {
      max = pixelData[i];
    }
  }
  return max;
};

// ====================================================================
// Create the pixel representation (type and length) from dicom tags ==
// ====================================================================
export const getPixelRepresentation = function(dataSet) {
  if (dataSet.repr) {
    return dataSet.repr;
  } else {
    // Bits Allocated (0028,0100) defines how much space is allocated
    // in the buffer for every sample in bits.
    let bitsAllocated = getTagValue(dataSet, "x00280100");
    // Pixel Representation (0028,0103) is either unsigned (0) or signed (1).
    // The default is unsigned.
    let pixelRepresentation = getTagValue(dataSet, "x00280103");
    let representation =
      pixelRepresentation === 1
        ? "Sint" + bitsAllocated
        : "Uint" + bitsAllocated;
    return representation;
  }
};

// ======================================================
// Create and return a typed array from the pixel data ==
// ======================================================
export const getPixelTypedArray = function(dataSet, pixelDataElement) {
  let pixels;
  let buffer = dataSet.byteArray.buffer;
  let offset = pixelDataElement.dataOffset;
  let length = pixelDataElement.length;

  let r = getPixelRepresentation(dataSet);

  switch (r) {
    case "Uint8":
      pixels = new Uint8Array(buffer, offset, length);
      break;
    case "Sint8":
      pixels = new Int8Array(buffer, offset, length);
      break;
    case "Uint16":
      pixels = new Uint16Array(buffer, offset, length / 2);
      break;
    case "Sint16":
      pixels = new Int16Array(buffer, offset, length / 2);
      break;
    case "Uint32":
      pixels = new Uint32Array(buffer, offset, length / 4);
      break;
    case "Sint32":
      pixels = new Int32Array(buffer, offset, length / 4);
      break;
    default:
      pixels = new Uint8Array(buffer, offset, length);
      break;
  }
  return pixels;
};

// ========================================================================
// Sort the array of images ids of a series trying with: ==================
// - content time order, if the series has cardiacNumberOfImages tag > 1 ==
// - position order, if series has needed patient position tags ===========
// - instance order, if series has instance numbers tags ==================
// The priority of the method depends on the instanceSortPriority value ===
// ========================================================================
export const getSortedStack = function(
  seriesData,
  sortPriorities,
  returnSuccessMethod
) {
  let tryToSort = function(data, methods) {
    if (isEmpty(methods)) {
      if (returnSuccessMethod === true) {
        return sorted;
      } else {
        return sorted;
      }
    }

    let sortMethod = methods.shift();
    try {
      var sorted = sortBy(data.imageIds, function(imageId) {
        return sortStackCallback(data, imageId, sortMethod);
      });
      if (returnSuccessMethod === true) {
        return sorted;
      } else {
        return sorted;
      }
    } catch (ex) {
      return tryToSort(data, methods);
    }
  };

  // sortPriorities will be shifted, so clone it before calling the tryToSort fucntion
  let clonedList = clone(sortPriorities);
  return tryToSort(seriesData, clonedList);
};

// =========================================================================
// Extract tag value according to its value rapresentation =================
// see http://dicom.nema.org/dicom/2013/output/chtml/part05/sect_6.2.html ==
// =========================================================================
export const getTagValue = function(dataSet, tag) {
  // tag value rapresentation
  let vr = getDICOMTag(tag).vr;

  // parse value according to vr map
  let vrParsingMap = {
    // Date
    // string of characters of the format YYYYMMDD; where YYYY shall contain year,
    // MM shall contain the month, and DD shall contain the day,
    // interpreted as a date of the Gregorian calendar system.
    DA: function() {
      let dateString = dataSet.string(tag);
      return dateString ? formatDate(dateString) : "";
    },
    // Decimal String
    // A string of characters representing either a fixed point number
    // or a floating point number.
    DS: function() {
      let array = dataSet.string(tag)
        ? dataSet
            .string(tag)
            .split("\\")
            .map(Number)
        : null;
      if (!array) {
        return null;
      }
      return array.length === 1 ? array[0] : array;
    },
    // Date Time
    // A concatenated date-time character string in the format:
    // YYYYMMDDHHMMSS.FFFFFF&ZZXX
    DT: function() {
      let dateString = dataSet.string(tag);
      return formatDateTime(dateString);
    },
    // Person Name
    // A character string encoded using a 5 component convention.
    // The character code 5CH (the BACKSLASH "\" in ISO-IR 6) shall
    // not be present, as it is used as the delimiter between values
    // in multiple valued data elements. The string may be padded
    // with trailing spaces. For human use, the five components
    // in their order of occurrence are: family name complex,
    // given name complex, middle name, name prefix, name suffix.
    PN: function() {
      let pn = dataSet.string(tag) ? dataSet.string(tag).split("^") : null;
      if (!pn) {
        return null;
      }

      let pns = [pn[3], pn[0], pn[1], pn[2], pn[4]];
      return pns.join(" ").trim();
    },
    // Signed Short
    // Signed binary integer 16 bits long in 2's complement form
    SS: function() {
      return dataSet.uint16(tag);
    },
    // Unique Identifier
    // A character string containing a UID that is used to uniquely
    // identify a wide letiety of items. The UID is a series of numeric
    // components separated by the period "." character.
    UI: function() {
      return dataSet.string(tag);
    },
    // Unsigned Short
    // Unsigned binary integer 16 bits long.
    US: function() {
      return dataSet.uint16(tag);
    },
    "US|SS": function() {
      return dataSet.uint16(tag);
    }
  };
  return vrParsingMap[vr] ? vrParsingMap[vr]() : dataSet.string(tag);
};

// ========================
// Generate a randomUUID ==
// ========================
export const randomId = function() {
  return rand() + rand();
};

// ==============================================
// Get the mean value of a specified dicom tag ==
// ==============================================
export const getMeanValue = function(series, tag, isArray) {
  let meanValue = isArray ? [] : 0;

  forEach(series.imageIds, function(imageId) {
    const tagValue = series.instances[imageId].metadata[tag];
    if (tagValue.length === 2) {
      meanValue[0] = meanValue[0] ? meanValue[0] + tagValue[0] : tagValue[0];
      meanValue[1] = meanValue[1] ? meanValue[1] + tagValue[1] : tagValue[1];
    } else if (tagValue.length === 3) {
      meanValue[0] = meanValue[0] ? meanValue[0] + tagValue[0] : tagValue[0];
      meanValue[1] = meanValue[1] ? meanValue[1] + tagValue[1] : tagValue[1];
      meanValue[2] = meanValue[2] ? meanValue[2] + tagValue[2] : tagValue[2];
    } else if (tagValue.length === 6) {
      meanValue[0] = meanValue[0] ? meanValue[0] + tagValue[0] : tagValue[0];
      meanValue[1] = meanValue[1] ? meanValue[1] + tagValue[1] : tagValue[1];
      meanValue[2] = meanValue[2] ? meanValue[2] + tagValue[2] : tagValue[2];
      meanValue[3] = meanValue[3] ? meanValue[3] + tagValue[3] : tagValue[3];
      meanValue[4] = meanValue[4] ? meanValue[4] + tagValue[4] : tagValue[4];
      meanValue[5] = meanValue[5] ? meanValue[5] + tagValue[5] : tagValue[5];
    } else {
      meanValue += tagValue;
    }
  });

  if (isArray) {
    for (let i = 0; i < meanValue.length; i++) {
      meanValue[i] /= series.imageIds.length;
    }
  } else {
    meanValue /= series.imageIds.length;
  }
  return meanValue;
};

// ==============================================================
// Compute resliced metadata from a cornerstone data structure ==
// ==============================================================
export const getReslicedMetadata = function(
  reslicedSeriesId,
  fromOrientation,
  toOrientation,
  seriesData,
  imageLoaderName
) {
  // get reslice metadata and apply the reslice algorithm
  let permuteTable = resliceTable[fromOrientation][toOrientation];
  let permuteAbsTable = permuteTable.map(function(v) {
    return Math.abs(v);
  });

  // orthogonal reslice algorithm
  let reslicedImageIds = [];
  let reslicedInstances = {};

  let sampleMetadata = seriesData.instances[seriesData.imageIds[0]].metadata;

  let fromSize = [
    sampleMetadata.x00280011,
    sampleMetadata.x00280010,
    seriesData.imageIds.length
  ];
  let toSize = permuteValues(permuteAbsTable, fromSize);
  let fromSpacing = spacingArray(seriesData, sampleMetadata);
  let toSpacing = permuteValues(permuteAbsTable, fromSpacing);
  let reslicedIOP = getReslicedIOP(sampleMetadata.x00200037, permuteTable);

  for (let f = 0; f < toSize[2]; f++) {
    let reslicedImageId = getCustomImageId(imageLoaderName);
    reslicedImageIds.push(reslicedImageId);

    let instanceId = uuid.v4();
    let reslicedIPP = getReslicedIPP(
      sampleMetadata.x00200032,
      sampleMetadata.x00200037,
      reslicedIOP,
      permuteTable,
      f,
      fromSize,
      toSize,
      fromSpacing
    );
    let metadata = extend(clone(sampleMetadata), {
      // pixel representation
      x00280100: sampleMetadata.x00280100,
      x00280103: sampleMetadata.x00280103,
      // resliced series sizes
      x00280010: toSize[1], // rows
      x00280011: toSize[0], // cols
      // resliced series spacing
      x00280030: [toSpacing[1], toSpacing[0]],
      x00180050: [toSpacing[2]],
      // remove min and max pixelvalue from metadata before calling the createCustomImage function:
      // need to recalculate the min and max pixel values on the new instance pixelData
      x00280106: undefined,
      x00280107: undefined,
      // resliced series data
      x0020000d: sampleMetadata.x0020000d,
      x0020000e: reslicedSeriesId,
      x00200011: random(10000),
      x00080018: instanceId,
      x00020003: instanceId,
      x00200013: f + 1,
      x00201041: getReslicedSliceLocation(reslicedIOP, reslicedIPP),
      x00100010: sampleMetadata.x00100010,
      x00081030: sampleMetadata.x00081030,
      x00080020: sampleMetadata.x00080020,
      x00080030: sampleMetadata.x00080030,
      x00080061: sampleMetadata.x00080061,
      x0008103e: sampleMetadata.x0008103e,
      x00080021: sampleMetadata.x00080021,
      x00080031: sampleMetadata.x00080031,
      x00080060: sampleMetadata.x00080060,
      x00280008: sampleMetadata.x00280008,
      x00101010: sampleMetadata.x00101010,
      x00020010: sampleMetadata.x00020010,
      x00200052: sampleMetadata.x00200052,
      // data needed to obtain a good rendering
      x00281050: sampleMetadata.x00281050,
      x00281051: sampleMetadata.x00281051,
      x00281052: sampleMetadata.x00281052,
      x00281053: sampleMetadata.x00281053,
      // new image orientation
      x00200037: reslicedIOP,
      // new image position
      x00200032: reslicedIPP
    });

    reslicedInstances[reslicedImageId] = {
      instanceId: instanceId,
      metadata: metadata,
      permuteTable: permuteTable
    };
  }

  return {
    imageIds: reslicedImageIds,
    instances: reslicedInstances,
    currentImageIdIndex: 0
  };
};

// ==============================================================================
// Get pixel data for a single resliced slice, from cornerstone data structure ==
// ==============================================================================
export const getReslicedPixeldata = function(
  imageId,
  originalData,
  reslicedData
) {
  // resliced metadata must be already available
  let reslicedInstance = reslicedData.instances[imageId];
  let reslicedMetadata = reslicedInstance.metadata;
  let permuteAbsTable = reslicedInstance.permuteTable.map(function(v) {
    return Math.abs(v);
  });

  // compute resliced series pixelData, use the correct typedarray
  let rows = reslicedMetadata.x00280010;
  let cols = reslicedMetadata.x00280011;
  let reslicedSlice = getTypedArray(reslicedMetadata, rows * cols);

  let frame = indexOf(reslicedData.imageIds, imageId);
  let originalInstance = originalData.instances[originalData.imageIds[0]];
  let fromCols = originalInstance.metadata.x00280011;

  function getPixelValue(ijf) {
    let i = ijf[0];
    let j = ijf[1];
    let f = ijf[2];

    let targetInstance = originalData.instances[originalData.imageIds[f]];
    if (!targetInstance) {
      console.log("ERROR");
      // TODO interpolate missing pixels when using an oversample reslice strategy
      // let f_padded = Math.floor(f / originalSampleMetadata.x00180050 * originalSampleMetadata.x00280030[0]);
      // targetInstance = originalSeries.instances[originalSeries.imageIds[f_padded]];
      return;
    }

    let targetPixeldata = targetInstance.pixelData;
    let index = j * fromCols + i;
    return targetPixeldata[index];
  }

  // flip f values
  if (isNegativeSign(reslicedInstance.permuteTable[2])) {
    frame = reslicedData.imageIds.length - frame;
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let ijf = [0, 0, 0];
      ijf[permuteAbsTable[0]] = i;
      ijf[permuteAbsTable[1]] = j;
      ijf[permuteAbsTable[2]] = frame;

      // flip j index
      let index;
      if (isNegativeSign(reslicedInstance.permuteTable[1])) {
        index = rows * cols - j * cols + i;
      } else {
        // TODO if oversample reslice strategy resample i or j
        // let i_padded = Math.floor(i * originalSampleMetadata.x00180050 / originalSampleMetadata.x00280030[0]);
        index = j * cols + i;
      }

      reslicedSlice[index] = getPixelValue(ijf);
    }
  }

  return reslicedSlice;
};

// ====================================
// Get distance between slices value ==
// ====================================
export const getDistanceBetweenSlices = function(
  seriesData,
  sliceIndex1,
  sliceIndex2
) {
  if (seriesData.imageIds.length <= 1) {
    return 0;
  }

  let imageId1 = seriesData.imageIds[sliceIndex1];
  let instance1 = seriesData.instances[imageId1];
  let metadata1 = instance1.metadata;
  let imageOrientation = metadata1.imageOrientation
    ? metadata1.imageOrientation
    : metadata1.x00200037;
  let imagePosition = metadata1.imagePosition
    ? metadata1.imagePosition
    : metadata1.x00200032;

  if (imageOrientation && imagePosition) {
    let normal = getNormalOrientation(imageOrientation);
    let d1 =
      normal[0] * imagePosition[0] +
      normal[1] * imagePosition[1] +
      normal[2] * imagePosition[2];

    let imageId2 = seriesData.imageIds[sliceIndex2];
    let instance2 = seriesData.instances[imageId2];
    let metadata2 = instance2.metadata;
    let imagePosition2 = metadata2.imagePosition
      ? metadata2.imagePosition
      : metadata2.x00200032;

    let d2 =
      normal[0] * imagePosition2[0] +
      normal[1] * imagePosition2[1] +
      normal[2] * imagePosition2[2];

    return Math.abs(d1 - d2);
  }
};

// =================================
// Parse an imageId string to int ==
// =================================
export function parseImageId(imageId) {
  let sliceNumber = imageId.split("//").pop();
  return parseInt(sliceNumber);
}

// =====================================================
// Remap a voxel cooordinates in a target orientation ==
// =====================================================
export function remapVoxel([i, j, k], fromOrientation, toOrientation) {
  if (fromOrientation == toOrientation) {
    return [i, j, k];
  }

  let permuteTable = resliceTable[toOrientation][fromOrientation];
  let permuteAbsTable = permuteTable.map(function(v) {
    return Math.abs(v);
  });

  // if permuteTable value is negative, count slices from the end
  var dims = getSerieDimensions();

  let i_ = isNegativeSign(permuteTable[0]) ? dims[fromOrientation][0] - i : i;
  let j_ = isNegativeSign(permuteTable[1]) ? dims[fromOrientation][1] - j : j;
  let k_ = isNegativeSign(permuteTable[2]) ? dims[fromOrientation][2] - k : k;

  let ijk = [0, 0, 0];
  ijk[permuteAbsTable[0]] = i_;
  ijk[permuteAbsTable[1]] = j_;
  ijk[permuteAbsTable[2]] = k_;

  return ijk;
}

/* Internal module functions */

// ======================================================================
// Returns the sorting value of the image id in the array of image ids ==
// of the series according with the chosen sorting method ===============
// ======================================================================
let sortStackCallback = function(seriesData, imageId, method) {
  switch (method) {
    case "instanceNumber":
      var instanceNumber = seriesData.instances[imageId].metadata.x00200013;
      instanceNumber = parseInt(instanceNumber);
      return instanceNumber;

    case "contentTime":
      var cardiacNumberOfImages =
        seriesData.instances[imageId].metadata.x00181090;
      var contentTime = seriesData.instances[imageId].metadata.x00080033;
      if (cardiacNumberOfImages && cardiacNumberOfImages > 1 && contentTime) {
        return contentTime;
      } else {
        throw "Not a time series: cardiacNumberOfImages tag not available or <= 1.";
      }

    case "imagePosition":
      var p = seriesData.instances[imageId].metadata.imagePosition;

      p = map(p, function(value) {
        return parseFloat(value);
      });

      var o = seriesData.instances[imageId].metadata.imageOrientation;
      o = map(o, function(value) {
        return parseFloat(value);
      });

      var v1, v2, v3;
      v1 = o[0] * o[0] + o[3] * o[3];
      v2 = o[1] * o[1] + o[4] * o[4];
      v3 = o[2] * o[2] + o[5] * o[5];

      var sortIndex;
      if (v1 <= v2 && v2 <= v3) {
        sortIndex = 0;
      }
      if (v2 <= v1 && v2 <= v3) {
        sortIndex = 1;
      }
      if (v3 <= v1 && v3 <= v2) {
        sortIndex = 2;
      }
      return p[sortIndex];
    default:
      break;
  }
};

// ==========================================
// Get the dicom tag code from dicom image ==
// ==========================================
let getDICOMTagCode = function(code) {
  let re = /x(\w{4})(\w{4})/;
  let result = re.exec(code);

  if (!result) {
    return code;
  }

  let newCode = "(" + result[1] + "," + result[2] + ")";
  newCode = newCode.toUpperCase();

  return newCode;
};

// =====================================
// Get the dicom tag from dicom image ==
// =====================================
let getDICOMTag = function(code) {
  let newCode = getDICOMTagCode(code);
  let tag = TAG_DICT[newCode];
  return tag;
};

// ==============================
// Convert date from dicom tag ==
// ==============================
let formatDate = function(date) {
  let yyyy = date.slice(0, 4);
  let mm = date.slice(4, 6);
  let dd = date.slice(6, 8);
  return (
    yyyy + "-" + (mm[1] ? mm : "0" + mm[0]) + "-" + (dd[1] ? dd : "0" + dd[0])
  );
};

// ==================================
// Convert datetime from dicom tag ==
// ==================================
let formatDateTime = function(date) {
  let yyyy = date.slice(0, 4);
  let mm = date.slice(4, 6);
  let dd = date.slice(6, 8);
  let hh = date.slice(8, 10);
  let m = date.slice(10, 12);
  let ss = date.slice(12, 14);

  return (
    yyyy +
    "-" +
    (mm[1] ? mm : "0" + mm[0]) +
    "-" +
    (dd[1] ? dd : "0" + dd[0]) +
    "/" +
    hh +
    ":" +
    m +
    ":" +
    ss
  );
};

// ==============================================================
// Generate a random number and convert it to base 36 (0-9a-z) ==
// ==============================================================
let rand = function() {
  return Math.random()
    .toString(36)
    .substr(2);
};

// ===============================================
// Permute array values using orientation array ==
// ===============================================
let permuteValues = function(convertArray, sourceArray) {
  let outputArray = new Array(convertArray.length);
  for (let i = 0; i < convertArray.length; i++) {
    outputArray[i] = sourceArray[convertArray[i]];
  }

  return outputArray;
};

// ==================================================
// Check negative sign, considering also 0+ and 0- ==
// ==================================================
let isNegativeSign = function(x) {
  return 1 / x !== 1 / Math.abs(x);
};

// ======================================================
// Get typed array from tag and size of original array ==
// ======================================================
let getTypedArray = function(tags, size) {
  let r = getPixelRepresentation(tags);

  let array;
  switch (r) {
    case "Uint8":
      array = new Uint8Array(size);
      break;
    case "Sint8":
      array = new Int8Array(size);
      break;
    case "Uint16":
      array = new Uint16Array(size);
      break;
    case "Sint16":
      array = new Int16Array(size);
      break;
    case "Uint32":
      array = new Uint32Array(size);
      break;
    case "Sint32":
      array = new Int32Array(size);
      break;
  }

  return array;
};

// =======================================================
// Get resliced image orientation tag from permuteTable ==
// =======================================================
let getReslicedIOP = function(iop, permuteTable) {
  if (!iop) {
    return null;
  }

  // compute resliced iop
  let u = iop.slice(0, 3);
  let v = iop.slice(3, 6);

  // abs the w array, the sign will be eventually changed during the permutation
  let w = getNormalOrientation(iop);
  // let absW = _.map(w, function(v) { return Math.abs(v); });

  // resliced iop components
  let shuffledIop = permuteSignedArrays(permuteTable, [u, v, w]);

  // keep the firts two components of shuffledIop
  return shuffledIop[0].concat(shuffledIop[1]);
};

// ==================================
// Get resliced image position tag ==
// ==================================
let getReslicedIPP = function(
  ipp,
  iop,
  reslicedIOP,
  permuteTable,
  imageIndex,
  fromSize,
  toSize,
  fromSpacing
) {
  // compute resliced ipp
  // TODO test synch and rl
  let reslicedIPP = [];

  // iop data
  let u = iop.slice(0, 3);
  let v = iop.slice(3, 6);
  let w = getNormalOrientation(iop);
  let absW = map(w, function(v) {
    return Math.abs(v);
  });
  let majorOriginalIndex = indexOf(absW, max(absW));

  let normalReslicedIop = getNormalOrientation(reslicedIOP);
  normalReslicedIop = map(normalReslicedIop, function(v) {
    return Math.abs(v);
  });

  let majorIndex = indexOf(normalReslicedIop, max(normalReslicedIop));
  let index = isNegativeSign(permuteTable[majorIndex])
    ? toSize[majorIndex] - imageIndex
    : imageIndex;

  // flip z value on original slice
  if (isNegativeSign(permuteTable[1])) {
    ipp = ipp.map(function(val, i) {
      return val + fromSize[2] * fromSpacing[2] * w[i];
    });
  }

  let spacing, versor;
  // to sagittal
  if (majorIndex == 0) {
    // original x spacing
    spacing = fromSpacing[0];
    versor = u;
  }
  // to coronal
  else if (majorIndex == 1) {
    // from sagittal
    if (majorOriginalIndex == 0) {
      spacing = fromSpacing[0];
      versor = u;

      // overwrite index with the majorOriginalIndex position
      // index = isNegativeSign(permuteTable[majorOriginalIndex]) ? (toSize[majorOriginalIndex] - imageIndex) : imageIndex;
    }
    // from axial
    else if (majorOriginalIndex == 2) {
      spacing = fromSpacing[1];
      versor = v;

      // overwrite index with the majorOriginalIndex position
      index = isNegativeSign(permuteTable[majorOriginalIndex])
        ? toSize[majorOriginalIndex] - imageIndex
        : imageIndex;
    }
  }
  // to axial
  else if (majorIndex == 2) {
    // original y spacing
    spacing = fromSpacing[1];
    versor = v;
  }

  reslicedIPP = ipp.map(function(val, i) {
    return val + index * spacing * versor[i];
  });

  return reslicedIPP;
};

// =========================================
// Get resliced normal orientation vector ==
// =========================================
let getReslicedSliceLocation = function(reslicedIOP, reslicedIPP) {
  let normalReslicedIop = getNormalOrientation(reslicedIOP);
  normalReslicedIop = map(normalReslicedIop, function(v) {
    return Math.abs(v);
  });

  let majorIndex = indexOf(normalReslicedIop, max(normalReslicedIop));
  return reslicedIPP[majorIndex];
};

// ====================================
// Get spacing array from seriesData ==
// ====================================
let spacingArray = function(seriesData, sampleMetadata) {
  // the spacingArray is as follows:
  // [0]: column pixelSpacing value (x00280030[1])
  // [1]: row pixelSpacing value (x00280030[0])
  // [2]: distance between slices, given the series imageOrientationPatient and
  //      imagePositionPatient of the first two slices

  let distanceBetweenSlices = sampleMetadata.x00180050
    ? sampleMetadata.x00180050
    : getDistanceBetweenSlices(seriesData, 0, 1);

  return [
    sampleMetadata.x00280030[1],
    sampleMetadata.x00280030[0],
    distanceBetweenSlices
  ];
};

// ==============================================
// Permute a signed array using original array ==
// ==============================================
let permuteSignedArrays = function(convertArray, sourceArray) {
  let outputArray = new Array(convertArray.length);
  for (let i = 0; i < convertArray.length; i++) {
    let sourceIndex = Math.abs(convertArray[i]);
    if (isNegativeSign(convertArray[i])) {
      outputArray[i] = sourceArray[sourceIndex].map(function(v) {
        return -v;
      });
    } else {
      outputArray[i] = sourceArray[sourceIndex];
    }
  }

  return outputArray;
};

export const getCmprMetadata = function() {
  return null; //DEV
};
