
class APManager {

    // constructor
    constructor(homey, gateway)
    {
        this.homey = homey; 
        this.homey.log('AP Manager constructor');     
        this.gateway = gateway;
        this.homey.log('AP Manager constructor gateway: '+this.gateway);
    }

    // update APs
    updateAPs(sys)
    {
        //this.homey.log('updating APs');
    }


}

module.exports = APManager;