import * as THREE from "three";

const debugTextures = false;
const debugMaterials = false;
const debugMeshes = false;
const debugPrims = false;
const disableTextures = false;
const disableMaterials = false;

class TextureRegistry {
  constructor(basename) {
    this.basename = basename;
    this.textures = [];
    this.loader = new THREE.TextureLoader();
    // HACK get URL ?file parameter again
    let urlParams = new URLSearchParams(window.location.search);
    let fileParam = urlParams.get('file');
    if (fileParam) {
      let lastSlash = fileParam.lastIndexOf('/');
      if (lastSlash >= 0)
        fileParam = fileParam.substring(0, lastSlash);
      this.baseUrl = fileParam;
  }
  getTexture(resourcePath) {
    if (debugTextures) console.log("get texture", resourcePath);
    if (this.textures[resourcePath]) {
      return this.textures[resourcePath];
    }

    let textureResolve, textureReject;
    this.textures[resourcePath] = new Promise((resolve, reject) => {
      textureResolve = resolve;
      textureReject = reject;
    });

    if (!resourcePath) {
      return Promise.reject(new Error('Empty resource path for file: ' + resourcePath + ' at ' + this.basename));
    }

    let filetype = undefined;
    let lowercaseFilename = resourcePath.toLowerCase();
    if (lowercaseFilename.indexOf('.png') >= lowercaseFilename.length - 5) {
      filetype = 'image/png';
    } else if (lowercaseFilename.indexOf('.jpg') >= lowercaseFilename.length - 5) {
      filetype = 'image/jpeg';
    } else if (lowercaseFilename.indexOf('.jpeg') >= lowercaseFilename.length - 5) {
      filetype = 'image/jpeg';
    } else if (lowercaseFilename.indexOf('.exr') >= lowercaseFilename.length - 4) {
      console.warn("EXR textures are not fully supported yet", resourcePath);
      // using EXRLoader explicitly
      filetype = 'image/x-exr';
    } else if (lowercaseFilename.indexOf('.tga') >= lowercaseFilename.length - 4) {
      console.warn("TGA textures are not fully supported yet", resourcePath);
      // using TGALoader explicitly
      filetype = 'image/tga';
    } else {
      console.error("Error when loading texture: unknown filetype", resourcePath);
      // throw new Error('Unknown filetype');
    }

    this.config.driver().getFile(resourcePath, async (loadedFile) => {
      let loader = this.loader;

      const baseUrl = this.baseUrl;
      function loadFromFile(_loadedFile) {
        let url = undefined;
        if (debugTextures) console.log("window.driver.getFile", resourcePath, " => ", _loadedFile);
        if (_loadedFile) {
          let blob = new Blob([_loadedFile.slice(0)], { type: filetype });
          url = URL.createObjectURL(blob);
        } else {
          if (baseUrl)
            url = baseUrl + '/' + resourcePath;
          else
            url = resourcePath;
        }
        if (debugTextures) console.log("Loading texture from", url, "with loader", loader, "_loadedFile", _loadedFile, "baseUrl", baseUrl, "resourcePath", resourcePath);
        // Load the texture
        loader.load(
          // resource URL
          url,

          // onLoad callback
          (texture) => {
            texture.name = resourcePath;
            textureResolve(texture);
          },

          // onProgress callback currently not used
          undefined,

          // onError callback
          (err) => {
            textureReject(err);
          }
        );
      }

      if (!loadedFile) {
        // if the file is not part of the filesystem, we can still try to fetch it from the network
        if (baseUrl) {
          console.log("File not found in filesystem, trying to fetch", resourcePath);
        }
        else {
          textureReject(new Error('Unknown file: ' + resourcePath));
          return;
        }
      }

      loadFromFile(loadedFile);
    });

    return this.textures[resourcePath];
  }
}

class HydraMesh {
  constructor(id, hydraInterface) {
    this._geometry = new THREE.BufferGeometry();
    this._id = id;
    this._interface = hydraInterface;
    this._points = undefined;
    this._normals = undefined;
    this._colors = undefined;
    this._uvs = undefined;
    this._indices = undefined;

    const material = new THREE.MeshPhysicalMaterial({
      side: THREE.DoubleSide,
      color: new THREE.Color(0x00ff00), // a green color to indicate a missing material
    });

    this._mesh = new THREE.Mesh(this._geometry, material);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;

    window.usdRoot.add(this._mesh); // FIXME
  }

  updateOrder(attribute, attributeName, dimension = 3) {
    if (attribute && this._indices) {
      let values = [];
      for (let i = 0; i < this._indices.length; i++) {
        let index = this._indices[i];
        for (let j = 0; j < dimension; ++j) {
          values.push(attribute[dimension * index + j]);
        }
      }
      this._geometry.setAttribute(
        attributeName,
        new THREE.Float32BufferAttribute(values, dimension)
      );
    }
  }

  updateIndices(indices) {
    this._indices = [];
    for (let i = 0; i < indices.length; i++) {
      this._indices.push(indices[i]);
    }
    //this._geometry.setIndex( indicesArray );
    this.updateOrder(this._points, "position");
    this.updateOrder(this._normals, "normal");
    if (this._colors) {
      this.updateOrder(this._colors, "color");
    }
    if (this._uvs) {
      this.updateOrder(this._uvs, "uv", 2);
      this._geometry.attributes.uv1 = this._geometry.attributes.uv;
    }
  }

  setTransform(matrix) {
    this._mesh.matrix.set(...matrix);
    this._mesh.matrix.transpose();
    this._mesh.matrixAutoUpdate = false;
  }

  updateNormals(normals) {
    this._normals = normals.slice(0);
    this.updateOrder(this._normals, "normal");
  }

  // This is always called before prims are updated
  setMaterial(materialId) {
    //console.log("Material: " + materialId);
    if (this._interface.materials[materialId]) {
      this._mesh.material = this._interface.materials[materialId]._material;
    }
  }

  setDisplayColor(data, interpolation) {
    let wasDefaultMaterial = false;
    if (this._mesh.material === defaultMaterial) {
      this._mesh.material = this._mesh.material.clone();
      wasDefaultMaterial = true;
    }

    this._colors = null;

    if (interpolation === "constant") {
      this._mesh.material.color = new THREE.Color().fromArray(data);
    } else if (interpolation === "vertex") {
      // Per-vertex buffer attribute
      this._mesh.material.vertexColors = true;
      if (wasDefaultMaterial) {
        // Reset the pink debugging color
        this._mesh.material.color = new THREE.Color(0xffffff);
      }
      this._colors = data.slice(0);
      this.updateOrder(this._colors, "color");
    } else {
      //console.warn(
      // `Unsupported displayColor interpolation type '${interpolation}'.`
      //);
    }
  }

  setUV(data, dimension, interpolation) {
    // TODO: Support multiple UVs. For now, we simply set uv = uv1, which is required when a material has an aoMap.
    this._uvs = null;

    if (interpolation === "facevarying") {
      // The UV buffer has already been prepared on the C++ side, so we just set it
      this._geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(data, dimension)
      );
    } else if (interpolation === "vertex") {
      // We have per-vertex UVs, so we need to sort them accordingly
      this._uvs = data.slice(0);
      this.updateOrder(this._uvs, "uv", 2);
    }
    this._geometry.attributes.uv1 = this._geometry.attributes.uv;
  }

  updatePrimvar(name, data, dimension, interpolation) {
    if (name === "points" || name === "normals") {
      // Points and normals are set separately
      return;
    }

    //console.log("Setting PrimVar: " + name);

    // TODO: Support multiple UVs. For now, we simply set uv = uv1, which is required when a material has an aoMap.
    if (name.startsWith("st")) {
      name = "uv";
    }

    switch (name) {
      case "displayColor":
        this.setDisplayColor(data, interpolation);
        break;
      case "uv":
        this.setUV(data, dimension, interpolation);
        break;
      default:
      //console.warn("Unsupported primvar", name);
    }
  }

  updatePoints(points) {
    this._points = points.slice(0);
    this.updateOrder(this._points, "position");
  }

  commit() {
    // Nothing to do here. All Three.js resources are already updated during the sync phase.
  }
}

let defaultMaterial;

class HydraMaterial {
  // Maps USD preview material texture names to Three.js MeshPhysicalMaterial names
  static usdPreviewToMeshPhysicalTextureMap = {
    diffuseColor: "map",
    clearcoat: "clearcoatMap",
    clearcoatRoughness: "clearcoatRoughnessMap",
    emissiveColor: "emissiveMap",
    occlusion: "aoMap",
    roughness: "roughnessMap",
    metallic: "metalnessMap",
    normal: "normalMap",
    opacity: "alphaMap",
  };

  static channelMap = {
    // Three.js expects many 8bit values such as roughness or metallness in a specific RGB texture channel.
    // We could write code to combine multiple 8bit texture files into different channels of one RGB texture where it
    // makes sense, but that would complicate this loader a lot. Most Three.js loaders don't seem to do it either.
    // Instead, we simply provide the 8bit image as an RGB texture, even though this might be less efficient.
    r: THREE.RGBAFormat,
    rgb: THREE.RGBAFormat,
    rgba: THREE.RGBAFormat,
  };

  // Maps USD preview material property names to Three.js MeshPhysicalMaterial names
  static usdPreviewToMeshPhysicalMap = {
    clearcoat: "clearcoat",
    clearcoatRoughness: "clearcoatRoughness",
    diffuseColor: "color",
    emissiveColor: "emissive",
    ior: "ior",
    metallic: "metalness",
    opacity: "opacity",
    roughness: "roughness",
  };

  constructor(id, hydraInterface) {
    this._id = id;
    this._nodes = {};
    this._interface = hydraInterface;
    if (!defaultMaterial) {
      defaultMaterial = new THREE.MeshPhysicalMaterial({
        side: THREE.DoubleSide,
        color: new THREE.Color(0xff2997), // a bright pink color to indicate a missing material
        envMap: window.envMap,
      });
    }
    this._material = defaultMaterial;
  }

  updateNode(networkId, path, parameters) {
    //console.log("Updating Material Node: " + networkId + " " + path);
    this._nodes[path] = parameters;
  }

  assignTexture(mainMaterial, parameterName) {
    const materialParameterMapName =
      HydraMaterial.usdPreviewToMeshPhysicalTextureMap[parameterName];
    if (materialParameterMapName === undefined) {
      console.warn(
        `Unsupported material texture parameter '${parameterName}'.`
      );
      return;
    }
    if (mainMaterial[parameterName] && mainMaterial[parameterName].nodeIn) {
      const textureFileName = mainMaterial[parameterName].nodeIn.file;
      const channel = mainMaterial[parameterName].inputName;

      // For debugging
      const matName = Object.keys(this._nodes).find(
        (key) => this._nodes[key] === mainMaterial
      );
      //console.log(
      //  `Setting texture '${materialParameterMapName}' (${textureFileName}) of material '${matName}'...`
      //);

      this._interface.registry.getTexture(textureFileName).then((texture) => {
        if (materialParameterMapName === "alphaMap") {
          // If this is an opacity map, check if it's using the alpha channel of the diffuse map.
          // If so, simply change the format of that diffuse map to RGBA and make the material transparent.
          // If not, we need to copy the alpha channel into a new texture's green channel, because that's what Three.js
          // expects for alpha maps (not supported at the moment).
          // NOTE that this only works if diffuse maps are always set before opacity maps, so the order of
          // 'assingTexture' calls for a material matters.
          if (
            textureFileName === mainMaterial.diffuseColor?.nodeIn?.file &&
            channel === "a"
          ) {
            this._material.map.format = THREE.RGBAFormat;
          } else {
            // TODO: Extract the alpha channel into a new RGB texture.
          }

          this._material.transparent = true;
          this._material.needsUpdate = true;
          return;
        } else if (materialParameterMapName === "metalnessMap") {
          this._material.metalness = 1.0;
        } else if (materialParameterMapName === "emissiveMap") {
          this._material.emissive = new THREE.Color(0xffffff);
        } else if (!HydraMaterial.channelMap[channel]) {
          //console.warn(`Unsupported texture channel '${channel}'!`);
          return;
        }

        // Clone texture and set the correct format.
        const clonedTexture = texture.clone();
        clonedTexture.format = HydraMaterial.channelMap[channel];
        clonedTexture.needsUpdate = true;

        // Provide proper texture color space for regular maps. The rest can keep default.
        if (parameterName === "diffuseColor" || parameterName === "emissiveColor") {
          clonedTexture.colorSpace = THREE.SRGBColorSpace; 
        }

        clonedTexture.wrapS = THREE.RepeatWrapping;
        clonedTexture.wrapT = THREE.RepeatWrapping;
        this._material[materialParameterMapName] = clonedTexture;
        this._material.needsUpdate = true;
      });
    }
  }

  assignProperty(mainMaterial, parameterName) {
    const materialParameterName =
      HydraMaterial.usdPreviewToMeshPhysicalMap[parameterName];
    if (materialParameterName === undefined) {
      //console.warn(`Unsupported material parameter '${parameterName}'.`);
      return;
    }
    if (
      mainMaterial[parameterName] !== undefined &&
      !mainMaterial[parameterName].nodeIn
    ) {
      //console.log(
      //  `Assigning property ${parameterName}: ${mainMaterial[parameterName]}`
      //);
      if (Array.isArray(mainMaterial[parameterName])) {
        this._material[materialParameterName] = new THREE.Color().fromArray(
          mainMaterial[parameterName]
        );
      } else {
        this._material[materialParameterName] = mainMaterial[parameterName];
        if (
          materialParameterName === "opacity" &&
          mainMaterial[parameterName] < 1.0
        ) {
          this._material.transparent = true;
        }
      }
    }
  }

  updateFinished(type, relationships) {
    for (let relationship of relationships) {
      relationship.nodeIn = this._nodes[relationship.inputId];
      relationship.nodeOut = this._nodes[relationship.outputId];
      relationship.nodeIn[relationship.inputName] = relationship;
      relationship.nodeOut[relationship.outputName] = relationship;
    }
    //console.log("Finalizing Material: " + this._id);

    // find the main material node
    let mainMaterialNode = undefined;
    for (let node of Object.values(this._nodes)) {
      if (node.diffuseColor) {
        mainMaterialNode = node;
        break;
      }
    }

    if (!mainMaterialNode) {
      this._material = defaultMaterial;
      return;
    }

    // TODO: Ideally, we don't recreate the material on every update.
    // Creating a new one requires to also update any meshes that reference it. So we're relying on the C++ side to
    // call this before also calling `setMaterial` on the affected meshes.
    //console.log("Creating Material: " + this._id);
    this._material = new THREE.MeshPhysicalMaterial({});

    // Assign textures
    for (let key in HydraMaterial.usdPreviewToMeshPhysicalTextureMap) {
      this.assignTexture(mainMaterialNode, key);
    }

    // Assign material properties
    for (let key in HydraMaterial.usdPreviewToMeshPhysicalMap) {
      this.assignProperty(mainMaterialNode, key);
    }

    if (window.envMap) {
      this._material.envMap = window.envMap;
    }
    //console.log(this._material);
  }
}

export class RenderDelegateInterface {
  constructor(filename, usdRoot) {
    this.registry = new TextureRegistry(filename);
    this.materials = {};
    this.meshes = {};
    window.usdRoot = usdRoot;
  }

  createRPrim(typeId, id, instancerId) {
    //console.log("Creating RPrim: " + typeId + " " + id);
    let mesh = new HydraMesh(id, this);
    this.meshes[id] = mesh;
    return mesh;
  }

  createBPrim(typeId, id) {
    //console.log("Creating BPrim: " + typeId + " " + id);
    /*let mesh = new HydraMesh(id, this);
    this.meshes[id] = mesh;
    return mesh;*/
  }

  createSPrim(typeId, id) {
    //console.log("Creating SPrim: " + typeId + " " + id);

    if (typeId === "material") {
      let material = new HydraMaterial(id, this);
      this.materials[id] = material;
      return material;
    } else {
      return undefined;
    }
  }

  setDriver(driver) {
    window.driver = driver;
  }

  CommitResources() {
    for (const id in this.meshes) {
      const hydraMesh = this.meshes[id];
      hydraMesh.commit();
    }
  }
}
