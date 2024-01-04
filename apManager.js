
class APManager {

    // constructor
    constructor(homey)
    {
        this.homey = homey; 
        this.homey.log('AP Manager constructor');     
    }

    // update APs
    updateAPs(sys)
    {
        this.homey.log('updating APs');
    }


}

module.exports = APManager;