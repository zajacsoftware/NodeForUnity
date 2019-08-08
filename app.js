const APIDataLoader = require('./APIDataLoader');
const dataLoader = new APIDataLoader();
const express = require('express');

const url = require('url');
const path = require('path');
const fs = require('fs');
const Stream = require("stream").Transform;
const mime = require('mime-types')
const https = require('https');
const static = express.static("public");

const app = express();
app.use(static);
app.use(express.json());   
app.use(express.urlencoded({ extended: false }));


// handling data request  ( availability and prices ) 
app.get("/localCache/plotData.json", (req, res, next) => {
 
        try {
            // trying to get latest cached data
            fs.readFile(__dirname+'/public/StreamingAssets/localCache/plotDataAll_latest.json', (err, json) => 
            {    
                let obj = JSON.parse(json);
                res.json(obj);
            });
        } catch(er)
        {
            try {
                   //fall back to the initial, hard coded data. This is always there and should be accessible at all times, 
                   //there are however circumstances where a file could be temporarily locked by another process so we need to capture this.
                fs.readFile(__dirname+'/public/StreamingAssets/plotDataAll.json', (err, json) => 
                {  
                    let obj = JSON.parse(json);
                    res.json(obj);
                });
            } catch(er)
            {
                // sending error. The client application has it's fall back mechanism in case there's no data available. 
                res.status(500).send({ error: 'Faild to load data.' });
            }
        }
})


// Whenever it's not practical to replicate applicattion's file structure then assetsMap object can be used to map expected file path to a diffrent location within the server
// eg: assetsMap["Assets/StreamingAssets/gallery/img1.jpg"] = __dirname+"/public/gallery/img1.jpg" 
const assetsMap = {};

// Emulates files system for Unity standalone applications exported as WebGL. 
// Allows the WebGL application to get a list of files in a particural directory 
app.get("/*", (req, res, next) => {

    const file_pattern = /.*(\/.+\.\w+$)/g;
    if (file_pattern.test(req.url)) {
        var key = req.url.toLowerCase();
        if (assetsMap && assetsMap[key]) {
            https.get(assetsMap[key], (resp) => {
                var data = new Stream();
                resp.on('data', function (chunk) {
                    data.push(chunk);
                });
                resp.on('end', function () {
                    fs.writeFileSync(__dirname + '/public' + req.url, data.read());

                    var gotType = mime.lookup(req.url);
                    if (gotType) {
                        fs.readFile(__dirname + '/public' + req.url, (er, srcd) => {
                            if (er) {
                                next();
                            } else {
                                res.writeHead(200, { 'Content-Type': gotType });
                                res.end(srcd, 'utf-8');
                            }
                        });
                    }
                });
            }).on("error", (err) => { 
                next();
            });
        } else {
            next();
        }
    } else {
        let path_string = path.join(__dirname, 'public', req.url);
        let fullUrl = req.protocol + '://' + req.get('host');
        try {
            if (fs.lstatSync(path_string).isDirectory()) {
                fs.readdir(path_string, (err, files) => {
                    let data = {
                        "url": fullUrl + (req.url.charAt(req.url.length - 1) != "/" ? req.url + "/" : req.url),
                        "filelist": []
                    };
                    files.forEach(file => {
                        data.filelist.push(encodeURIComponent(file));
                    });
                    res.json(data);
                });
            }
        } catch (er) {
            res.json({ data: "nogo" });
        }
    }
});


app.listen(8080, () => {

    // Starting update loop  
    loadAndCacheLoop();
 
    console.log("listening on 8080");
});


// Reads data from incomatible API and converts to format expected by application
function processData(data) {
    const availabilityMap = { "Unreleased": 0, "Unavailable": 0,  "Available": 1, "Sold": 2, "Reserved": 3 };
    let processed = [];
    let parsed;

    try {
        parsed = JSON.parse(data);
    } catch (er) {
        return null; 
    }

    if (!parsed || !parsed[0]) { 
        return null; 
    }
       
    for (var key in parsed) {

        let plotName =   tryToGetValue(parsed[key], "name", null);

        if (!plotName) {
            return null;
        }

        //   let assetsId = plotName.replace(/\s/g,'').toLowerCase();  // to be used for assets caching
        
        let index = parseInt(plotName.match(/\d+/)[0]);

        processed.push({
            Collection: tryToGetValue(parsed[key], "criteria.propertytype.values.0.value", ""),
            Id: tryToGetValue(parsed[key], "name", ""),
            Index: index,
            Avilability: (availabilityMap[tryToGetValue(parsed[key], "criteria.propertyavailability.values.0.value", null)]||availabilityMap["Unreleased"]),
            Bed: tryToGetValue(parsed[key], "bedrooms", ""),
            Type: "Home",
            Floor: "1",
            Price: tryToGetValue(parsed[key], "price", null)||"£TBA",
            Dims: formatDimentions( parsed[key].dimensions), 
            PlanPath: `http://localhost:8080/plans/plot${index}.jpg`,
            LocatorPath: `http://localhost:8080/locators/plot${index}.jpg`,
            phase_name: "phase1",
        });
    }
  
    processed.sort((a,b) => (a.Index > b.Index) ? 1 : ((b.Index > a.Index) ? -1 : 0)); 

    return  JSON.stringify({data:processed});
}

// Converts proporty rooms data into format expected by the application 
function formatDimentions(srcObj) {
    if(!srcObj) return "";
    let output = [["Room","Dims(m)","Dims(ft/in)"]];
    for (var i = 0,  length = srcObj.length; i < length; i++) {
        let name = tryToGetValue(srcObj[i], "name", "Room");
        let metric =  `${tryToGetValue(srcObj[i],"metric.width", "NaN")} x ${tryToGetValue(srcObj[i],"metric.length", "NaN")}`;
        let imperial =  `${tryToGetValue(srcObj[i],"imperial.width.feet", "NaN")}foot${tryToGetValue(srcObj[i],"imperial.width.feet", "NaN")}inch x ${tryToGetValue(srcObj[i],"imperial.length.feet", "NaN")}foot${tryToGetValue(srcObj[i],"imperial.length.inches", "NaN")}inch`;
        output.push([name, metric, imperial ]);
    }

    return JSON.stringify(output);
}

// Checking steap by step if expected data really exists and if it does not returns a failValue which does not brake the application functionally and visually.
function tryToGetValue(obj, propPathStr, failValue) {
    let output = obj;
    const pathAsArray = propPathStr.split('.');
    try {
    
        for (var i = 0,  length = pathAsArray.length; i < length; i++) {
            output = output[pathAsArray[i]];
            if(!output) {
                 return failValue;
            }
        }
        return  output;
    } catch (error) {
        console.log(error);
    }
    return failValue;
}

// saving latest data localy. 
function writeLocalData(data) {

    let proccesed = processData(data);
    // proccesed can only be a valid json or null;
    if(proccesed !== null) {
        fs.writeFile(__dirname + '/public/StreamingAssets/localCache/plotDataAll_latest.json', proccesed, (err) => {
            if (err) {
                console.log("err saving data");
            }
        });
    }
}

// TODO: add note why not using setInterval() 
function loadAndCacheLoop()
{
    dataLoader.once(APIDataLoader.LOADING_FINISHED, (data) => {
        writeLocalData(data);
    });
    
    dataLoader.loadData();
    setTimeout(loadAndCacheLoop, 300000); // 5 minutes; 
}
