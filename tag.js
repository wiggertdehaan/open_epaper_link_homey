
class Tag {

    // constructor
    constructor(homey)
    {
        this.homey = homey; 
        this.homey.log('Tag constructor');     
        //this.log('Tag constructor');
    }


}

module.exports = Tag;