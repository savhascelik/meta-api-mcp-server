#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url'; // URL nesnesi için

// --- Konfigürasyon ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'api-configs'); // Varsayılan yerel klasör
const CONFIG_TIMEOUT = 15000; // Uzak konfigürasyonlar için timeout (15 saniye)

let apiConfigs = {}; // Yüklenen tüm API konfigürasyonları
let toolsList = [];  // Oluşturulan araç listesi

// --- Yardımcı Fonksiyon: JSON Schema Üret (Değişiklik Yok) ---
function generateInputSchema(parameters) {
    if (!parameters || parameters.length === 0) return { type: "object", properties: {} };
    const properties = {};
    const required = [];
    parameters.forEach(param => {
        const schemaType = param.type || 'string';
        properties[param.name] = { type: schemaType, description: param.description || ''};
        if (param.required) required.push(param.name);
    });
    return { type: "object", properties: properties, required: required.length > 0 ? required : undefined };
}

// --- Yardımcı Fonksiyon: Tek Bir Konfigürasyonu İşle ve Araçları Ekle ---
function processConfigAndAddTools(config, sourceDescription) {
     if (config.apiId && config.endpoints) {
        // Bu sunucu sadece HTTP API'lerini destekliyor varsayalım
        // Eğer bir handlerType belirtilmişse ve httpApi değilse atlayabiliriz (geleceğe hazırlık)
        if (config.handlerType && config.handlerType !== 'httpApi') {
             console.warn(`! Warning: Skipping config for ${config.apiId} from ${sourceDescription}. Handler type '${config.handlerType}' not supported by this server version.`);
             return;
        }

        apiConfigs[config.apiId] = config; // Konfigürasyonu sakla
        console.error(`- Loaded config for: ${config.apiId} from ${sourceDescription}`);

        config.endpoints.forEach(ep => {
            // Bu sunucu sadece GET, POST, PUT, DELETE, PATCH gibi yaygın HTTP metodlarını destekler
            const supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
            if (!ep.targetMethod || !supportedMethods.includes(ep.targetMethod.toUpperCase())) {
                console.warn(`! Warning: Skipping endpoint ${ep.mcpOperationId || ep.targetPath} for ${config.apiId}. Unsupported or missing targetMethod.`);
                return;
            }
            if (!ep.targetPath) {
                 console.warn(`! Warning: Skipping endpoint ${ep.mcpOperationId || 'N/A'} for ${config.apiId}. Missing targetPath.`);
                 return;
            }

            // Tool adını oluştur
            let opIdPart = ep.mcpOperationId || ep.targetMethod.toLowerCase() + ep.targetPath.replace(/[\/{}]/g, '_');
            // API ID ve Operation ID'nin toplam uzunluğunu kontrol et ve gerekirse kısalt
            const maxLength = 50;
            const separator = '__';
            const apiIdPart = config.apiId;
            
            // Toplam uzunluk kontrolü
            if ((apiIdPart + separator + opIdPart).length > maxLength) {
                const maxOpIdLength = maxLength - apiIdPart.length - separator.length;
                if (maxOpIdLength > 5) {
                    // Operation ID kısmını kısalt, en az 5 karakter bırak
                    opIdPart = opIdPart.substring(0, maxOpIdLength);
                } else {
                    // API ID çok uzunsa, onu da kısalt ve Operation ID için en az 10 karakter bırak
                    const maxApiIdLength = maxLength - 10 - separator.length;
                    const truncatedApiId = apiIdPart.substring(0, maxApiIdLength);
                    const truncatedOpId = opIdPart.substring(0, 10);
                    opIdPart = truncatedOpId;
                    apiIdPart = truncatedApiId;
                }
            }

            // apiIdPart'ın ilk harflerini al (kelimelerin ilk harfleri, _ ile ayrılmış)
            const toolName = `${opIdPart}`;

            toolsList.push({
                name: toolName,
                description: ep.description || `Calls ${ep.targetMethod} ${ep.targetPath} on ${config.apiId}`,
                inputSchema: generateInputSchema(ep.parameters),
                // Gelecekte eklenti mimarisi için referansları saklayabiliriz
                _internalInfo: {
                     apiId: config.apiId,
                     mcpOperationId: ep.mcpOperationId // Orijinal ID'yi de saklayalım
                }
            });
        });
    } else {
        console.error(`! Warning: Invalid config structure from ${sourceDescription}. Missing apiId or endpoints.`);
    }
}


// --- Yardımcı Fonksiyon: Konfigürasyonları Yükle (Esnek Kaynak) ---
async function loadConfigurations(configSource) {
    apiConfigs = {}; // Öncekileri temizle
    toolsList = [];  // Öncekileri temizle
    console.error(`Loading configurations from source: ${configSource}`);

    try {
        // 1. URL mi diye kontrol et
        let isUrl = false;
        try {
            // Windows dosya yollarını (örn. D:/) URL olarak algılamayı önle
            if (!configSource.match(/^[a-zA-Z]:[\\\/]/)) {
                new URL(configSource);
                isUrl = true;
            }
        } catch (_) {
            isUrl = false;
        }

        // Ek kontrol: Windows sürücü harfi içeren yolları URL olarak algılama
        if (configSource.match(/^[a-zA-Z]:[\\\/]/)) {
            isUrl = false;
            console.error(`Detected Windows file path: ${configSource}`);
        }

        // 2. Dosya uzantısını kontrol et - URLs için de çalışır
        const isJsonListFile = configSource.toLowerCase().endsWith('.json') && 
                              (configSource.toLowerCase().includes('list') || configSource.toLowerCase().includes('config-list'));

        if (isJsonListFile) {
            // --- URL veya yerel dosyadan liste yükleme ---
            console.error(`Source appears to be a configuration list file.`);
            let configListContent;
            
            if (isUrl) {
                // Uzak URL'den yükle
                const response = await axios.get(configSource, { timeout: CONFIG_TIMEOUT });
                if (response.status !== 200) {
                    throw new Error(`Failed to fetch config list from URL ${configSource}. Status: ${response.status}`);
                }
                configListContent = response.data;
            } else {
                // Yerel dosyadan yükle
                const fileContent = await fs.readFile(path.resolve(configSource), 'utf8');
                configListContent = JSON.parse(fileContent);
            }
            
            // Liste dosyası bir dizi olmalı
            if (!Array.isArray(configListContent)) {
                throw new Error(`Config list at ${configSource} is not a valid array.`);
            }
            
            console.error(`Found ${configListContent.length} configurations to load from list.`);
            
            // Listedeki her konfigürasyon kaynağı için recursively loadConfigurations çağır
            for (const subConfigSource of configListContent) {
                try {
                    // Recursive çağrı - alt kaynak için aynı fonksiyonu kullan
                    console.error(`Loading sub-configuration from: ${subConfigSource}`);
                    
                    // Alt kaynağın bir URL veya yerel dosya olup olmadığını kontrol et
                    let subIsUrl = false;
                    try {
                        if (!subConfigSource.match(/^[a-zA-Z]:[\\\/]/)) {
                            new URL(subConfigSource);
                            subIsUrl = true;
                        }
                    } catch (_) {
                        subIsUrl = false;
                    }
                    
                    // URL ise, direkt yükle
                    if (subIsUrl) {
                        const response = await axios.get(subConfigSource, { timeout: CONFIG_TIMEOUT });
                        if (response.status === 200) {
                            const data = response.data;
                            if (Array.isArray(data)) {
                                console.error(`Fetched an array of ${data.length} configurations from ${subConfigSource}.`);
                                data.forEach(config => processConfigAndAddTools(config, subConfigSource));
                            } else if (typeof data === 'object' && data !== null) {
                                console.error(`Fetched a single configuration object from ${subConfigSource}.`);
                                processConfigAndAddTools(data, subConfigSource);
                            } else {
                                console.error(`! Error: Invalid data format received from URL ${subConfigSource}. Expected JSON object or array.`);
                            }
                        } else {
                            console.error(`! Error: Failed to fetch configurations from URL ${subConfigSource}. Status: ${response.status}`);
                        }
                    } else {
                        // Yerel dosya ise, onu işle (tek-seviye recursion - daha derine inme)
                        const localPath = path.resolve(subConfigSource);
                        console.error(`Sub-source is a local path: ${localPath}`);
                        const fileContent = await fs.readFile(localPath, 'utf8');
                        const config = JSON.parse(fileContent);
                        
                        if (Array.isArray(config)) {
                            config.forEach(c => processConfigAndAddTools(c, localPath));
                        } else {
                            processConfigAndAddTools(config, localPath);
                        }
                    }
                } catch (subError) {
                    console.error(`! Error loading sub-configuration from ${subConfigSource}: ${subError.message}. Continuing with other configurations.`);
                    // Hata olsa bile devam et, tüm liste başarısız olmasın
                }
            }
            
            return; // Liste işlendikten sonra çık
        }

        if (isUrl) {
            // --- Uzak URL'den Yükleme ---
            console.error(`Source is a URL. Fetching...`);
            const response = await axios.get(configSource, { timeout: CONFIG_TIMEOUT });
            if (response.status === 200) {
                const data = response.data;
                if (Array.isArray(data)) {
                    // Eğer URL bir JSON dizisi döndürüyorsa (birden fazla config içeriyorsa)
                    console.error(`Fetched an array of ${data.length} configurations.`);
                    data.forEach(config => processConfigAndAddTools(config, configSource));
                } else if (typeof data === 'object' && data !== null) {
                    // Eğer URL tek bir JSON nesnesi döndürüyorsa
                    console.error(`Fetched a single configuration object.`);
                    processConfigAndAddTools(data, configSource);
                } else {
                    console.error(`! Error: Invalid data format received from URL ${configSource}. Expected JSON object or array.`);
                }
            } else {
                console.error(`! Error: Failed to fetch configurations from URL ${configSource}. Status: ${response.status}`);
            }
        } else {
            // --- Yerel Dosya/Klasörden Yükleme ---
            const localPath = path.resolve(configSource); // Göreceli yolu çöz
            console.error(`Source is a local path: ${localPath}`);
            const stats = await fs.stat(localPath);

            if (stats.isDirectory()) {
                // Eğer bir klasörse, içindeki tüm .json dosyalarını yükle
                console.error(`Path is a directory. Reading JSON files...`);
                const files = await fs.readdir(localPath);
                const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

                for (const file of jsonFiles) {
                    const filePath = path.join(localPath, file);
                    try {
                        const fileContent = await fs.readFile(filePath, 'utf8');
                        const config = JSON.parse(fileContent);
                        processConfigAndAddTools(config, filePath);
                    } catch (err) {
                        console.error(`! Error reading or parsing local file ${filePath}:`, err.message);
                    }
                }
            } else if (stats.isFile() && path.extname(localPath).toLowerCase() === '.json') {
                // Eğer tek bir .json dosyasıysa, onu yükle
                console.error(`Path is a single JSON file. Reading...`);
                 try {
                        const fileContent = await fs.readFile(localPath, 'utf8');
                        const config = JSON.parse(fileContent);
                        processConfigAndAddTools(config, localPath);
                 } catch (err) {
                        console.error(`! Error reading or parsing local file ${localPath}:`, err.message);
                 }
            } else {
                console.error(`! Error: Local path ${localPath} is not a valid directory or .json file.`);
            }
        }
    } catch (error) {
        console.error(`! Fatal Error loading configurations from ${configSource}:`, error.message);
        // Hata durumunda belki varsayılanları yükle veya çıkış yap
        throw new Error(`Failed to load configurations from ${configSource}`);
    }

    if (toolsList.length === 0) {
        console.warn("! Warning: No tools were loaded. The server might not be useful.");
    } else {
         console.error(`Total tools loaded: ${toolsList.length}. Ready.`);
    }
}


// --- MCP Sunucusunu Oluştur ---
const server = new Server({ name: "meta-api-mcp-server", version: "1.0.0" });

// --- Request Handler: ListTools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error(`Received ListTools request. Returning ${toolsList.length} tools.`);
    return { tools: toolsList };
});

// --- Request Handler: CallTool ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: toolArgs } = request.params;
    console.error(`Received CallTool request for: ${toolName}`);

    // 1. Aracı ve ilgili konfigürasyonları bul
    const toolInfo = toolsList.find(t => t.name === toolName);
    if (!toolInfo || !toolInfo._internalInfo?.apiId) {
        return { content: [{ type: "text", text: `Error: Tool '${toolName}' not found or improperly configured.` }] };
    }
    const targetApiId = toolInfo._internalInfo.apiId;
    const apiConfig = apiConfigs[targetApiId];
     // mcpOperationId'yi _internalInfo'dan alalım ya da endpoint listesinden tekrar bulalım
    const endpointConfig = apiConfig?.endpoints.find(ep =>
        (ep.mcpOperationId || ep.targetMethod.toLowerCase() + ep.targetPath.replace(/[\/{}]/g, '_')) === toolName
    );


    if (!apiConfig || !endpointConfig) {
        return { content: [{ type: "text", text: `Error: Internal configuration error for tool '${toolName}'.` }] };
    }

    // 2. HTTP Handler Mantığını Çalıştır (Doğrudan burada veya ayrı fonksiyonda)
    try {
        console.error(`Executing HTTP API call for operation: ${toolName}`);

        // Kimlik Doğrulama
        const authConfig = apiConfig.authentication;
        const headers = {};
        const queryParamsForKey = {};
         if (authConfig?.type === 'apiKey' && authConfig.envVariable) {
             const apiKey = process.env[authConfig.envVariable];
             if (!apiKey) throw new Error(`API Key env var ${authConfig.envVariable} not set for ${targetApiId}.`);
             if (authConfig.keyLocation === 'header') headers[authConfig.keyName] = apiKey;
             else if (authConfig.keyLocation === 'query') queryParamsForKey[authConfig.keyName] = apiKey;
         } else if (authConfig?.type === 'bearerToken' && authConfig.envVariable) {
             const token = process.env[authConfig.envVariable];
             if (!token) throw new Error(`Bearer Token env var ${authConfig.envVariable} not set for ${targetApiId}.`);
             headers['Authorization'] = `Bearer ${token}`;
         }
         // TODO: Diğer auth tipleri

        // URL ve Parametreler
        let targetPath = endpointConfig.targetPath;
        const queryParams = { ...queryParamsForKey };
        let requestBody = null;

        if (endpointConfig.parameters && toolArgs) {
             for (const paramDef of endpointConfig.parameters) {
                 const argValue = toolArgs[paramDef.name];
                 if (paramDef.required && (argValue === undefined || argValue === null)) {
                    throw new Error(`Missing required argument: ${paramDef.name}`);
                 }
                 if (argValue !== undefined && argValue !== null) {
                    if (paramDef.in === 'path') {
                        targetPath = targetPath.replace(`{${paramDef.name}}`, encodeURIComponent(String(argValue)));
                    } else if (paramDef.in === 'query') {
                        queryParams[paramDef.name] = String(argValue);
                    } else if (paramDef.in === 'header') {
                        headers[paramDef.name] = String(argValue);
                    } else if (paramDef.in === 'body') {
                        // Basit body işleme (tek body parametresi veya tüm argümanlar)
                        if(requestBody === null) requestBody = {};
                         requestBody[paramDef.name] = argValue;
                         // Veya daha gelişmiş şema bazlı body oluşturma
                         // Şimdilik, eğer tek body parametresi varsa tüm argümanları kabul edelim:
                         // if(endpointConfig.parameters.filter(p=>p.in === 'body').length === 1){
                         //     requestBody = toolArgs;
                         // }
                    }
                }
            }
            // Body için daha iyi kontrol
             const bodyParamDef = endpointConfig.parameters.find(p => p.in === 'body');
             if(bodyParamDef && toolArgs){
                  requestBody = toolArgs[bodyParamDef.name] ?? toolArgs;
                 if (requestBody !== null) {
                     headers['Content-Type'] = 'application/json';
                 }
             }
        }

        const targetUrl = `${apiConfig.baseUrl}${targetPath}`;

        // Axios Çağrısı
        console.error(`-> Calling HTTP Target: ${endpointConfig.targetMethod} ${targetUrl}`);
        const apiResponse = await axios({
            method: endpointConfig.targetMethod.toUpperCase(),
            url: targetUrl,
            params: queryParams,
            data: requestBody,
            headers: headers,
            validateStatus: () => true,
        });
        console.error(`<- HTTP Target Response Status: ${apiResponse.status}`);

        // Yanıtı Formatla
        let responseText = '';
        if (typeof apiResponse.data === 'object') {
            try { responseText = JSON.stringify(apiResponse.data, null, 2); } catch { responseText = String(apiResponse.data); }
        } else { responseText = String(apiResponse.data); }

        if (apiResponse.status >= 200 && apiResponse.status < 400) {
             console.error(`   Success Response Body (truncated): ${responseText.substring(0, 100)}...`);
             return { content: [{ type: "text", text: responseText }] };
        } else {
             console.error(`   Error Response: ${responseText}`);
             throw new Error(`Target API Error (Status ${apiResponse.status}): ${responseText.substring(0, 200)}...`);
        }

    } catch (error) {
        console.error(`! Error executing tool ${toolName}:`, error.message);
        return { content: [{ type: "text", text: `Error processing ${toolName}: ${error.message}` }] };
    }
});


// --- Ana Başlatma Fonksiyonu ---
async function main() {
    // Konfigürasyon kaynağını belirle (öncelik: env > argüman > varsayılan)
    const configSource = process.env.MCP_CONFIG_SOURCE || process.argv[2] || DEFAULT_CONFIG_PATH;
    try {
        await loadConfigurations(configSource);

        // StdIO transportunu kur ve sunucuyu başlat
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error(`Meta API MCP Server (v1 - HTTP Only) running on stdio.`);
        console.error(`Loaded configs from: ${configSource}`);
        console.error("Waiting for requests...");

    } catch (error) {
        console.error("! Error during startup:", error.message);
        process.exit(1);
    }
}


// Başlat
main();