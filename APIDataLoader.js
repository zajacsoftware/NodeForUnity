const fs = require('fs');
const https = require('https');
const EventEmitter = require('events');

class APIDataLoader extends EventEmitter
{
    static get LOADING_FINISHED() {return "loadingFinished";}
    
    constructor()
    {
        super();
    }

    loadData()
    {
        https.get('https://api.bradleydyer.com/v1/pdms/properties/?detailed=true&filters[]=and-development.id-eq-value-1YTsfYr4Bqn&rd-app-token=~1a5~1bAbbeyBarn~1clZZOcoGZyv~1da49250cf7b0830b23aa0cfe03e6329bf09258e79a8766f35b6a1b87f37ff973a~1eX-App-Token~1falex.longshaw', 
        (resp) => {    
            let data = '';
            resp.on('data', (chunk) => {
                data += chunk;
            });

            resp.on('end', () =>
            {
                this.emit(APIDataLoader.LOADING_FINISHED, data);
            });
              
            }).on("error", (err) => {
                this.emit(APIDataLoader.LOADING_FINISHED, '');
            });
    }
}

module.exports = APIDataLoader;